import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0"
import { loadMeliCredentials, refreshMeliCredentials } from "../_shared/meli-credentials.ts";

serve(async (req) => {
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    const supabase = createClient(supabaseUrl!, supabaseKey!)

    const privateMode = Deno.env.get("MELI_PRIVATE_CREDENTIALS_ENABLED") === "true"
    if ((privateMode || new URL(req.url).searchParams.has("conta_id")) && (!supabaseKey || req.headers.get("Authorization") !== `Bearer ${supabaseKey}`)) {
      return new Response("Acesso restrito ao serviço.", { status: 401 })
    }

    const accountId = new URL(req.url).searchParams.get("conta_id")
    if (privateMode && !accountId) {
      return new Response("Informe a conta da sincronização.", { status: 400 })
    }
    const accounts = supabase.from("meli_contas").select("id,seller_id_meli")
    const { data: candidates, error: accountError } = accountId
      ? await accounts.eq("id", accountId)
      : await accounts.limit(2)
    if (accountError) return new Response("Falha ao consultar conta.", { status: 500 })
    if (!candidates?.length) return new Response("Nenhuma conta encontrada.", { status: 404 })
    if (candidates.length !== 1) {
      return new Response("Informe a conta da sincronização.", { status: 400 })
    }

    const conta = candidates[0]
    const sellerId = conta.seller_id_meli
    const credentials = await loadMeliCredentials(supabase, conta.id, privateMode)
    let token = credentials.access_token
    const meProbe = await fetch("https://api.mercadolibre.com/users/me", {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (meProbe.status === 401) {
      token = await refreshMeliCredentials(supabase, conta.id, privateMode, credentials.refresh_token)
    } else if (!meProbe.ok) {
      return new Response("Falha ao validar a conta no Mercado Livre.", { status: 502 })
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
      const searchData = await searchRes.json()

      if (!searchRes.ok) {
        return new Response(
          `Erro ao buscar anúncios (offset ${offset}): ${JSON.stringify(searchData)}`,
          { status: searchRes.status }
        )
      }

      if (searchData.paging?.total !== undefined) {
        total = searchData.paging.total
      }

      const results = searchData.results || []
      if (results.length === 0) break

      allItemIds = allItemIds.concat(results)
      offset += PAGE_SIZE
    }

    if (allItemIds.length === 0) {
      return new Response(`Nenhum anúncio encontrado.`, { status: 200 })
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

      const itemsUrl = `https://api.mercadolibre.com/items?ids=${idsParaBuscar}&attributes=id,title,price,status,available_quantity,secure_thumbnail,pictures,attributes`
      const itemsRes  = await fetch(itemsUrl, { headers: { Authorization: `Bearer ${token}` } })
      const itemsData = await itemsRes.json()

      for (const itemObj of itemsData) {
        if (itemObj.code !== 200) continue
        const item = itemObj.body

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
    return new Response(htmlSucesso, { headers: { "Content-Type": "text/html; charset=utf-8" } })

  } catch (err: any) {
    return new Response(`Erro de Execução: ${err.message}`, { status: 500 })
  }
})
