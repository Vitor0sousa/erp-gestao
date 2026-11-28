import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0"
import { loadMeliCredentials, refreshMeliCredentials } from "../_shared/meli-credentials.ts"

// =========================================================================
// meli-backfill-pedidos
//
// Função de execução MANUAL (rode 1x, ou algumas vezes se precisar retomar).
//
// Objetivo: preencher a tabela `pedidos` com o histórico dos últimos 2 meses,
// já incluindo taxa_ml e custo_frete — pra que o Dashboard Financeiro tenha
// dados corretos mesmo pra vendas anteriores à ativação do webhook.
//
// REGRAS DE SEGURANÇA (não repita os erros do backfill errado):
// 1. NUNCA chama decrementar_estoque nem insere em estoque_movimentos.
//    Essas vendas já aconteceram fisicamente — o estoque atual já reflete
//    isso. Recalcular a baixa aqui geraria estoque negativo/errado.
// 2. Idempotente: pode rodar mais de uma vez sem duplicar nada
//    (upsert em pedidos, insert protegido por constraint em itens_pedido).
// 3. Pedido cujo item não tem vínculo em anuncio_skus: o PEDIDO é salvo
//    (conta pro faturamento bruto), mas o ITEM não entra em itens_pedido
//    (não conta pro custo nem pro ranking de mais vendido).
// =========================================================================

serve(async (req) => {
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (req.method !== 'POST') return new Response('Apenas POST permitido.', { status: 405 })
    if (!supabaseUrl || !supabaseKey) return new Response('Configuração indisponível.', { status: 503 })
    if (req.headers.get('Authorization') !== `Bearer ${supabaseKey}`) {
      return new Response('Acesso restrito ao serviço.', { status: 401 })
    }

    const supabase = createClient(supabaseUrl, supabaseKey)
    const privateMode = Deno.env.get('MELI_PRIVATE_CREDENTIALS_ENABLED') === 'true'
    const accountId = new URL(req.url).searchParams.get('conta_id')
    if (privateMode && !accountId) {
      return new Response('Informe a conta da sincronização.', { status: 400 })
    }

    const accounts = supabase.from('meli_contas').select('id,seller_id_meli')
    const { data: candidates, error: accountError } = accountId
      ? await accounts.eq('id', accountId)
      : await accounts.limit(2)
    if (accountError) return new Response('Falha ao consultar conta.', { status: 500 })
    if (!candidates?.length) return new Response('Nenhuma conta encontrada.', { status: 404 })
    if (candidates.length !== 1) {
      return new Response('Informe a conta da sincronização.', { status: 400 })
    }

    const conta = candidates[0]
    const sellerId = conta.seller_id_meli
    const credentials = await loadMeliCredentials(supabase, conta.id, privateMode)
    let token = credentials.access_token
    const probe = () => fetch('https://api.mercadolibre.com/users/me', {
      headers: { Authorization: `Bearer ${token}` },
    })
    let me = await probe()
    if (me.status === 401) {
      token = await refreshMeliCredentials(supabase, conta.id, privateMode, credentials.refresh_token)
      me = await probe()
    }
    if (!me.ok || String((await me.json()).id) !== sellerId) {
      return new Response('Falha ao validar a conta no Mercado Livre.', { status: 502 })
    }

    // ── 3. Define o período: últimos 2 meses até agora ──
    const dataFim = new Date()
    const dataInicio = new Date()
    dataInicio.setMonth(dataInicio.getMonth() - 2)

    const isoInicio = dataInicio.toISOString()
    const isoFim = dataFim.toISOString()

    // ── 4. Busca os IDs de pedidos no período, paginando ──
    const PAGE_SIZE = 50
    const MAX_TOTAL_OFFSET = 1000 // mesmo limite estrutural do /items/search

    let orderIds: number[] = []
    let offset = 0
    let total = Infinity

    while (offset < total && offset < MAX_TOTAL_OFFSET) {
      const searchUrl =
        `https://api.mercadolibre.com/orders/search` +
        `?seller=${sellerId}` +
        `&order.status=paid` +
        `&order.date_created.from=${encodeURIComponent(isoInicio)}` +
        `&order.date_created.to=${encodeURIComponent(isoFim)}` +
        `&limit=${PAGE_SIZE}&offset=${offset}`

      const searchRes = await fetch(searchUrl, { headers: { Authorization: `Bearer ${token}` } })
      const searchData = await searchRes.json()

      if (!searchRes.ok) {
        return new Response(
          `Erro ao buscar pedidos (offset ${offset}): ${JSON.stringify(searchData)}. ` +
          `Se o erro for de parâmetro inválido, os nomes dos filtros de data podem ` +
          `precisar de ajuste — veja a resposta bruta acima.`,
          { status: searchRes.status }
        )
      }

      if (searchData.paging?.total !== undefined) {
        total = searchData.paging.total
      }

      const results = searchData.results || []
      if (results.length === 0) break

      orderIds = orderIds.concat(results.map((r: any) => r.id))
      offset += PAGE_SIZE
    }

    if (orderIds.length === 0) {
      return new Response("Nenhum pedido encontrado no período de 2 meses.", { status: 200 })
    }

    // ── 5. Processa cada pedido individualmente ──
    let pedidosNovos = 0
    let pedidosAtualizados = 0
    let itensComVinculo = 0
    let itensSemVinculo = 0
    let erros = 0

    for (const orderId of orderIds) {
      try {
        const orderRes = await fetch(`https://api.mercadolibre.com/orders/${orderId}`, {
          headers: { Authorization: `Bearer ${token}` }
        })
        const orderData = await orderRes.json()

        if (!orderRes.ok || orderData.error
          || String(orderData.id) !== String(orderId) || String(orderData.seller?.id) !== sellerId) {
          console.error(`Pedido ${orderId} indisponível para o seller selecionado (${orderRes.status}).`)
          erros++
          continue
        }

        // Verifica se já existe
        const { data: pedidoExistente } = await supabase
          .from('pedidos')
          .select('id, taxa_ml')
          .eq('order_id_meli', orderData.id.toString())
          .eq('conta_id', conta.id)
          .maybeSingle()

        const taxaMlTotal = (orderData.order_items || []).reduce(
          (soma: number, item: any) => soma + (typeof item.sale_fee === 'number' ? item.sale_fee : 0),
          0
        )

        let custoFrete = 0
        if (orderData.shipping?.id) {
          custoFrete = await buscarCustoFrete(orderData.shipping.id, token)
        }

        let pedidoId: string

        if (pedidoExistente) {
          // Já existe — só atualiza taxa/frete se ainda não tinham sido preenchidos
          if (pedidoExistente.taxa_ml === null) {
            await supabase
              .from('pedidos')
              .update({ taxa_ml: taxaMlTotal, custo_frete: custoFrete })
              .eq('id', pedidoExistente.id)
            pedidosAtualizados++
          }
          pedidoId = pedidoExistente.id
        } else {
          const { data: novoPedido, error: insertErr } = await supabase
            .from('pedidos')
            .insert({
              order_id_meli: orderData.id.toString(),
              conta_id: conta.id,
              data_venda: orderData.date_created,
              status_pedido: orderData.status,
              valor_total: orderData.total_amount,
              taxa_ml: taxaMlTotal,
              custo_frete: custoFrete
            })
            .select('id')
            .single()

          if (insertErr || !novoPedido) {
            console.error(`Erro ao inserir pedido ${orderId}:`, insertErr)
            erros++
            continue
          }

          pedidoId = novoPedido.id
          pedidosNovos++
        }

        // ── Itens do pedido — SEM mexer em estoque ──
        for (const orderItem of orderData.order_items || []) {
          const itemIdMeli = orderItem.item.id
          const qtdVendida = orderItem.quantity

          const { data: anuncio } = await supabase
            .from('meli_anuncios')
            .select('id')
            .eq('item_id_meli', itemIdMeli)
            .eq('conta_id', conta.id)
            .single()

          if (!anuncio) {
            itensSemVinculo++
            continue
          }

          const { data: ligacao } = await supabase
            .from('anuncio_skus')
            .select('id, produto_interno_id')
            .eq('anuncio_id', anuncio.id)
            .single()

          if (!ligacao || !ligacao.produto_interno_id) {
            itensSemVinculo++
            continue
          }

          // Insert protegido pela constraint unique — se já existir, ignora silenciosamente
          const { error: itemInsertErr } = await supabase.from('itens_pedido').insert({
            pedido_id: pedidoId,
            anuncio_sku_id: ligacao.id,
            quantidade_vendida: qtdVendida
          })

          if (itemInsertErr && itemInsertErr.code !== '23505') {
            console.error(`Erro ao inserir item do pedido ${orderId}:`, itemInsertErr)
          } else if (!itemInsertErr) {
            itensComVinculo++
          }
        }

        // Pequeno intervalo entre pedidos pra não estourar rate limit do ML
        await new Promise(resolve => setTimeout(resolve, 150))

      } catch (err: any) {
        console.error(`Erro inesperado no pedido ${orderId}:`, err.message)
        erros++
      }
    }

    const htmlSucesso = `
      <html lang="pt-BR">
        <meta charset="UTF-8">
        <body style="font-family: sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; background-color: #f0fdf4;">
          <h1 style="color: #15803d;">Backfill de Pedidos Concluído!</h1>
          <p style="color: #555;">Período: ${dataInicio.toLocaleDateString('pt-BR')} até ${dataFim.toLocaleDateString('pt-BR')}</p>
          <ul style="font-size: 1.2rem; color: #333; line-height: 1.8;">
            <li>🔎 <b>${orderIds.length}</b> pedidos encontrados no período.</li>
            <li>🆕 <b>${pedidosNovos}</b> pedidos novos inseridos.</li>
            <li>🔄 <b>${pedidosAtualizados}</b> pedidos existentes com taxa/frete preenchidos.</li>
            <li>🔗 <b>${itensComVinculo}</b> itens vinculados a produtos internos.</li>
            <li>⚠️ <b>${itensSemVinculo}</b> itens sem vínculo (pedido contou no faturamento, item não entrou no custo).</li>
            <li>❌ <b>${erros}</b> erros durante o processamento.</li>
          </ul>
          <p style="margin-top: 20px; color: #666;">Nenhum estoque foi alterado por esta execução.</p>
        </body>
      </html>
    `
    return new Response(htmlSucesso, { headers: { "Content-Type": "text/html; charset=utf-8" } })

  } catch (err: any) {
    return new Response(`Erro de Execução: ${err.message}`, { status: 500 })
  }
})

// ── Mesma lógica de custo de frete usada no meli-webhook ──
async function buscarCustoFrete(shippingId: number | string, token: string): Promise<number> {
  try {
    const res = await fetch(`https://api.mercadolibre.com/shipments/${shippingId}/costs`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'x-format-new': 'true'
      }
    })

    if (!res.ok) return 0

    const data = await res.json()

    if (Array.isArray(data?.senders) && data.senders.length > 0) {
      const custoSender = data.senders.find((s: any) => typeof s.cost === 'number')
      if (custoSender) return custoSender.cost
    }

    if (typeof data?.cost === 'number') return data.cost
    if (typeof data?.gross_amount === 'number') return data.gross_amount

    return 0
  } catch {
    return 0
  }
}
