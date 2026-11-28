import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0"
import { loadMeliCredentials, refreshMeliCredentials } from "../_shared/meli-credentials.ts";

async function fetchItemDetails(url: string, token: string): Promise<Response> {
  const headers = { Authorization: `Bearer ${token}` }
  let response = await fetch(url, { headers })
  for (const backoffMs of [1000, 2500]) {
    if (![429, 500, 502, 503, 504].includes(response.status)) break
    const retryAfter = response.headers.get('Retry-After')
    const requestedDelay = retryAfter === null ? 0 : /^\d+$/.test(retryAfter)
      ? Number(retryAfter) * 1000
      : Math.max(0, Date.parse(retryAfter) - Date.now())
    if (requestedDelay > 8000) break
    await response.body?.cancel()
    const delay = Math.max(backoffMs, requestedDelay || 0) + Math.floor(Math.random() * 250)
    await new Promise(resolve => setTimeout(resolve, delay))
    response = await fetch(url, { headers })
  }
  return response
}

serve(async (req) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Cache-Control': 'no-store',
  }
  const fail = (status: number, erro: string) => Response.json({ ok: false, erro }, { status, headers })
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers })
  if (req.method !== 'POST') return fail(405, 'Apenas POST permitido.')

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!supabaseUrl || !supabaseKey) return fail(503, 'Sincronização indisponível.')
    const bearer = req.headers.get('Authorization')?.match(/^Bearer (\S+)$/i)?.[1]
    if (!bearer) return fail(401, 'Sessão inválida.')

    const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } })
    const serviceCaller = bearer === supabaseKey
    if (!serviceCaller) {
      const { data, error } = await supabase.auth.getUser(bearer)
      if (error || !data.user) return fail(401, 'Sessão inválida.')
      if (data.user.id !== Deno.env.get('ERP_INTEGRATIONS_ADMIN_USER_ID')) {
        return fail(403, 'A sincronização exige acesso de administrador das integrações.')
      }
    }

    const privateMode = Deno.env.get("MELI_PRIVATE_CREDENTIALS_ENABLED") === "true"
    const accountId = new URL(req.url).searchParams.get("conta_id")
    if (accountId !== null && !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(accountId)) {
      return fail(400, 'Conta de sincronização inválida.')
    }
    const accounts = supabase.from("meli_contas").select("id,seller_id_meli")
    const { data: candidates, error: accountError } = accountId
      ? await accounts.eq("id", accountId)
      : await accounts.limit(2)
    if (accountError) return fail(500, 'Falha ao consultar conta.')
    if (!candidates?.length) return fail(404, 'Nenhuma conta encontrada.')
    if (candidates.length !== 1) {
      return fail(400, 'Selecione a loja para sincronizar.')
    }

    const conta = candidates[0]
    const sellerId = conta.seller_id_meli
    const credentials = await loadMeliCredentials(supabase, conta.id, privateMode)
    let token = credentials.access_token
    const probe = () => fetch("https://api.mercadolibre.com/users/me", {
      headers: { Authorization: `Bearer ${token}` },
    })
    let me = await probe()
    if (me.status === 401) {
      token = await refreshMeliCredentials(supabase, conta.id, privateMode, credentials.refresh_token)
      me = await probe()
    }
    if (!me.ok || String((await me.json()).id) !== sellerId) {
      return fail(502, 'Falha ao validar a conta no Mercado Livre.')
    }

    // ── 3. Busca TODOS os anúncios, paginando ──
    // A busca padrão do ML limita a 100 itens por página e 1000 no total (offset+limit <= 1000).
    // Se você tiver mais de 1000 anúncios ativos, essa API não serve mais — é preciso usar
    // search_type=scan com scroll_id, que é uma lógica bem diferente (me avisa se for o caso).
    const PAGE_SIZE = 100
    const MAX_TOTAL_OFFSET = 1000

    let allItemIds: string[] = []
    let offset = 0
    let total = Infinity // será atualizado após a primeira chamada

    while (offset < total && offset < MAX_TOTAL_OFFSET) {
      const searchUrl = `https://api.mercadolibre.com/users/${sellerId}/items/search?limit=${PAGE_SIZE}&offset=${offset}`
      const searchRes = await fetch(searchUrl, { headers: { Authorization: `Bearer ${token}` } })
      if (!searchRes.ok) {
        return fail(502, 'Falha ao buscar anúncios no Mercado Livre.')
      }
      const searchData = await searchRes.json()

      if (searchData.paging?.total !== undefined) {
        total = searchData.paging.total
      }

      const results = searchData.results || []
      if (results.length === 0) break

      allItemIds = allItemIds.concat(results)
      offset += PAGE_SIZE
    }

    if (allItemIds.length === 0) {
      return Response.json({ ok: true, anunciosSalvos: 0 }, { headers })
    }

    let anunciosSalvos  = 0
    let produtosCriados = 0
    let linksCriados    = 0
    let semFoto         = 0

    // ── 4. Processamento em lotes de 20 (limite da API de multiget do ML) ──
    const chunkSize = 20
    for (let i = 0; i < allItemIds.length; i += chunkSize) {
      const chunk        = allItemIds.slice(i, i + chunkSize)
      const idsParaBuscar = chunk.join(',')

      const itemsUrl = `https://api.mercadolibre.com/items?ids=${idsParaBuscar}&attributes=id,seller_id,title,price,status,available_quantity,secure_thumbnail,pictures,attributes`
      const itemsRes = await fetchItemDetails(itemsUrl, token)
      if (!itemsRes.ok) {
        console.warn('meli_listing_details_failed', { status: itemsRes.status, offset: i })
        if (itemsRes.status === 429) return fail(429, 'O Mercado Livre limitou a consulta. Tente novamente em alguns instantes.')
        return fail(502, 'Falha ao importar detalhes dos anúncios.')
      }
      const itemsData = await itemsRes.json()

      for (const itemObj of itemsData) {
        const item = itemObj.body
        if (itemObj.code !== 200 || !chunk.includes(item?.id) || String(item.seller_id) !== sellerId) continue

        const primeiraPicture = Array.isArray(item.pictures) && item.pictures.length > 0
          ? item.pictures[0]
          : null

        const fotoUrl =
          primeiraPicture?.secure_url ||
          primeiraPicture?.url?.replace('http://', 'https://') ||
          item.secure_thumbnail ||
          null

        if (!fotoUrl) semFoto++

        const { data: anuncio, error: upsertAnuncioErr } = await supabase
          .from('meli_anuncios')
          .upsert({
            item_id_meli:   item.id,
            conta_id:       conta.id,
            titulo_anuncio: item.title,
            foto_url:       fotoUrl,
            preco:          item.price,
            status:         item.status
          }, { onConflict: 'item_id_meli' })
          .select('id')
          .single()

        if (upsertAnuncioErr || !anuncio) continue
        anunciosSalvos++

        const skuAttr = item.attributes?.find((a: any) => a.id === 'SELLER_SKU')
        const skuMeli = skuAttr ? skuAttr.value_name : null

        if (skuMeli) {
          let { data: produtoFisico } = await supabase
            .from('produtos_internos')
            .select('id')
            .eq('sku_interno', skuMeli)
            .single()

          if (!produtoFisico) {
            const { data: novoProduto } = await supabase
              .from('produtos_internos')
              .insert({
                sku_interno:   skuMeli,
                nome_produto:  item.title,
                tipo:          'SIMPLES',
                estoque_fisico: item.available_quantity || 0
              })
              .select('id')
              .single()

            produtoFisico = novoProduto
            if (produtoFisico) produtosCriados++
          }

          if (produtoFisico) {
            const { data: linkExistente } = await supabase
              .from('anuncio_skus')
              .select('id')
              .eq('anuncio_id', anuncio.id)
              .is('variacao_id_meli', null)
              .single()

            if (!linkExistente) {
              await supabase
                .from('anuncio_skus')
                .insert({
                  anuncio_id:         anuncio.id,
                  variacao_id_meli:   null,
                  produto_interno_id: produtoFisico.id
                })
              linksCriados++
            }
          }
        }
      }
    }

    if (!serviceCaller) return Response.json({ ok: true, anunciosSalvos, produtosCriados, linksCriados }, { headers })

    const htmlSucesso = `
      <html lang="pt-BR">
        <meta charset="UTF-8">
        <body style="font-family: sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; background-color: #f0fdf4;">
          <h1 style="color: #15803d;">Sincronização Completa Realizada!</h1>
          <ul style="font-size: 1.2rem; color: #333; line-height: 1.8;">
            <li>📄 <b>${allItemIds.length}</b> anúncios encontrados no total (${Math.ceil(allItemIds.length / PAGE_SIZE)} página(s)).</li>
            <li>📦 <b>${anunciosSalvos}</b> anúncios processados/atualizados.</li>
            <li>🖼️ <b>${anunciosSalvos - semFoto}</b> anúncios com foto salva.</li>
            <li>⚠️ <b>${semFoto}</b> anúncios sem foto no ML.</li>
            <li>🏷️ <b>${produtosCriados}</b> novos SKUs cadastrados no estoque.</li>
            <li>🔗 <b>${linksCriados}</b> novas ligações criadas.</li>
          </ul>
          <p style="margin-top: 20px; color: #666;">Verifique as tabelas no Supabase!</p>
        </body>
      </html>
    `
    return new Response(htmlSucesso, { headers: { ...headers, "Content-Type": "text/html; charset=utf-8" } })

  } catch {
    return fail(500, 'Falha ao sincronizar anúncios.')
  }
})
