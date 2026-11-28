import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.0"
import { loadMeliCredentials, refreshMeliCredentials } from "../_shared/meli-credentials.ts"

// =========================================================================
// MUDANÇAS PRINCIPAIS EM RELAÇÃO À VERSÃO ANTERIOR:
//
// 1. Responde 200 pro Mercado Livre IMEDIATAMENTE, antes de processar.
// 2. A baixa de estoque de cada item do pedido só acontece se o insert
//    em `itens_pedido` for realmente novo (protegido pela constraint unique).
// 3. Decremento de estoque via função SQL atômica (decrementar_estoque).
// 4. Captura taxa_ml e custo_frete real via /shipments/{id}/costs.
// 5. NOVO: Renovação automática do token do Mercado Libre antes de processar.
// =========================================================================

serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response("Apenas POST permitido", { status: 405 })
  }

  const durableInbox = Deno.env.get('MELI_DURABLE_INBOX_ENABLED') === 'true'
  if (req.headers.get('x-meli-inbox-worker') === 'true') {
    return await processarFila(req, durableInbox)
  }

  let body: any
  try {
    body = await req.json()
  } catch {
    return new Response(durableInbox ? "Notificação inválida" : "OK", { status: durableInbox ? 400 : 200 })
  }

  if (durableInbox) return await registrarNotificacao(body)

  // @ts-ignore - EdgeRuntime é global no runtime do Supabase Edge Functions
  EdgeRuntime.waitUntil(processarNotificacao(body).catch(() => {
    console.error('Falha no processamento da notificação')
  }))

  // Responde já — o processamento real acontece em background.
  return new Response("OK", { status: 200 })
})

async function registrarNotificacao(body: any): Promise<Response> {
  const { topic, resource, user_id } = body ?? {}
  if (topic !== 'items' && topic !== 'orders_v2') return new Response("OK")
  const seller = typeof user_id === 'number' && Number.isSafeInteger(user_id)
    ? String(user_id)
    : user_id
  const resourcePattern = topic === 'items' ? /^\/items\/[A-Z]{3}[0-9]{1,30}$/ : /^\/orders\/[0-9]{1,30}$/
  if (typeof seller !== 'string' || !/^[0-9]{1,30}$/.test(seller)
    || typeof resource !== 'string' || !resourcePattern.test(resource)) {
    return new Response("Notificação inválida", { status: 400 })
  }

  const url = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) return new Response("Fila indisponível", { status: 503 })
  try {
    const { error } = await createClient(url, key).rpc('enqueue_meli_notification', {
      p_seller_id: seller, p_topic: topic, p_resource: resource,
    })
    if (error) return new Response("Fila indisponível", { status: 503 })
    return new Response("OK")
  } catch {
    return new Response("Fila indisponível", { status: 503 })
  }
}

async function processarFila(req: Request, durableInbox: boolean): Promise<Response> {
  const url = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!key || req.headers.get('Authorization') !== `Bearer ${key}`) {
    return new Response('Acesso restrito ao serviço', { status: 401 })
  }
  if (!url || !durableInbox || Deno.env.get('MELI_ATOMIC_STOCK_ENABLED') !== 'true') {
    return new Response('Worker indisponível', { status: 503 })
  }

  const supabase = createClient(url, key)
  const { data: event, error } = await supabase.rpc('claim_meli_notification').maybeSingle<{
    event_id: string; seller_id: string; topic: string; resource: string; lease_token: string
  }>()
  if (error) return new Response('Fila indisponível', { status: 503 })
  if (!event) return new Response(null, { status: 204 })

  let success = false
  try {
    await processarNotificacao({ topic: event.topic, resource: event.resource, user_id: event.seller_id })
    success = true
  } catch {
    console.error('Falha ao processar evento da fila', event.event_id)
  }

  const result = await supabase.rpc('finish_meli_notification', {
    p_event_id: event.event_id, p_lease_token: event.lease_token, p_success: success,
  })
  if (result.error || result.data !== true) {
    return new Response('Falha ao registrar resultado da fila', { status: 503 })
  }
  return Response.json({ event_id: event.event_id, processed: success })
}

async function processarNotificacao(body: any) {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const supabase = createClient(supabaseUrl, supabaseKey)

  const { topic, resource, user_id } = body
  if (!user_id || typeof resource !== 'string') return
  if (topic === 'items' && !/^\/items\/[A-Z]{3}[0-9]+$/.test(resource)) return
  if (topic === 'orders_v2' && !/^\/orders\/[0-9]+$/.test(resource)) return
  if (topic !== 'items' && topic !== 'orders_v2') return

  const { data: conta, error: contaError } = await supabase
    .from('meli_contas')
    .select('id, seller_id_meli, revisar_vinculos')
    .eq('seller_id_meli', user_id.toString())
    .single()

  if (contaError || !conta) throw new Error("seller_unavailable")

  if (topic === 'items') {
    // Importa apenas o anúncio notificado, sem alterar o estoque no Mercado Livre.
    // A função destinatária valida a chave de serviço recebida no Authorization.
    const syncResponse = await fetch(`${supabaseUrl}/functions/v1/meli-sync-item`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ resource, user_id })
    })

    if (!syncResponse.ok) throw new Error('item_sync_failed')
  } else if (topic === 'orders_v2') {
    const privateMode = Deno.env.get('MELI_PRIVATE_CREDENTIALS_ENABLED') === 'true'
    const credentials = await loadMeliCredentials(supabase, conta.id, privateMode)
    await processarPedido(supabase, conta, resource, credentials, privateMode)
  }
}

// =========================================================================
// 📦 TÓPICO: ANÚNCIOS (CRIADOS OU ALTERADOS NO MERCADO LIVRE)
// =========================================================================
async function processarItem(supabase: any, conta: any, resource: string) {
  console.log(`📦 O anúncio ${resource} foi criado ou alterado no ML!`)

  const itemReq = await fetch(`https://api.mercadolibre.com${resource}`, {
    headers: { Authorization: `Bearer ${conta.access_token}` }
  })
  const itemData = await itemReq.json()

  if (itemData.error) {
    console.error("Erro ao buscar detalhes do anúncio:", itemData)
    return
  }

  const itemId = itemData.id

  const skuAttr = itemData.attributes?.find((a: any) => a.id === 'SELLER_SKU')
  const skuMeli = skuAttr ? skuAttr.value_name : null

  if (!skuMeli) {
    console.log(`⚠️ O anúncio ${itemId} não tem SKU. Impossível vincular automaticamente.`)
    return
  }

  const { data: produto } = await supabase
    .from('produtos_internos')
    .select('id, estoque_fisico, nome_produto')
    .eq('sku_interno', skuMeli)
    .single()

  if (!produto) {
    console.log(`⚠️ O SKU ${skuMeli} existe no ML mas não no ERP. Nenhuma ação feita.`)
    return
  }

  const { data: anuncio } = await supabase
    .from('meli_anuncios')
    .upsert({
      item_id_meli: itemId,
      conta_id: conta.id,
      titulo_anuncio: itemData.title,
      foto_url: itemData.secure_thumbnail,
      preco: itemData.price,
      status: itemData.status
    }, { onConflict: 'item_id_meli' })
    .select('id')
    .single()

  if (anuncio) {
    const { data: linkExistente } = await supabase
      .from('anuncio_skus')
      .select('id')
      .eq('anuncio_id', anuncio.id)
      .is('variacao_id_meli', null)
      .single()

    if (!linkExistente) {
      await supabase.from('anuncio_skus').insert({
        anuncio_id: anuncio.id,
        variacao_id_meli: null,
        produto_interno_id: produto.id
      })
      console.log(`🔗 Link criado entre o anúncio ${itemId} e o produto ${produto.nome_produto}`)
    }
  }

  const estoqueNoML = itemData.available_quantity
  const estoqueReal = produto.estoque_fisico || 0

  if (estoqueNoML !== estoqueReal) {
    console.log(`🔄 Diferença encontrada! ML: ${estoqueNoML} | ERP: ${estoqueReal}. Corrigindo no ML...`)

    await fetch(`https://api.mercadolibre.com/items/${itemId}`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${conta.access_token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ available_quantity: estoqueReal })
    })

    console.log(`✅ Anúncio ${itemId} corrigido para ${estoqueReal} unidades.`)
  } else {
    console.log(`✅ Estoque do anúncio já está correto (${estoqueReal}).`)
  }
}

// =========================================================================
// 💵 HELPER: busca o custo real de frete pago pelo vendedor
// =========================================================================
async function buscarCustoFrete(shippingId: number | string, token: string): Promise<number> {
  try {
    const res = await fetch(`https://api.mercadolibre.com/shipments/${shippingId}/costs`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'x-format-new': 'true'
      }
    })

    if (!res.ok) {
      console.log(`⚠️ Não foi possível buscar custo de frete do shipment ${shippingId} (status ${res.status}).`)
      return 0
    }

    const data = await res.json()

    if (Array.isArray(data?.senders) && data.senders.length > 0) {
      const custoSender = data.senders.find((s: any) => typeof s.cost === 'number')
      if (custoSender) return custoSender.cost
    }

    if (typeof data?.cost === 'number') return data.cost
    if (typeof data?.gross_amount === 'number') return data.gross_amount

    return 0
  } catch (err: any) {
    console.error(`Erro ao buscar custo de frete do shipment ${shippingId}:`, err.message)
    return 0
  }
}

// =========================================================================
// 💰 TÓPICO: VENDAS (BAIXA DE ESTOQUE E KITS) — IDEMPOTENTE E RESILIENTE
// =========================================================================
async function processarPedido(
  supabase: SupabaseClient,
  conta: { id: string; seller_id_meli: string; revisar_vinculos: boolean },
  resource: string,
  credentials: { access_token: string; refresh_token: string },
  privateMode: boolean,
) {
  let accessToken = credentials.access_token
  const fetchOrder = () => fetch(`https://api.mercadolibre.com${resource}`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  })
  let orderReq = await fetchOrder()
  if (orderReq.status === 401) {
    accessToken = await refreshMeliCredentials(supabase, conta.id, privateMode, credentials.refresh_token)
    orderReq = await fetchOrder()
  }

  if (!orderReq.ok) throw new Error('sale_request_failed')
  const orderData = await orderReq.json()
  if (orderData.error || String(orderData.id) !== resource.slice('/orders/'.length)
    || String(orderData.seller?.id) !== conta.seller_id_meli) {
    throw new Error('sale_seller_mismatch')
  }

  const orderIdStr = String(orderData.id)
  const atomicStock = Deno.env.get('MELI_ATOMIC_STOCK_ENABLED') === 'true'

  // ── Taxa ML: soma o sale_fee de cada item do pedido ──
  const taxaMlTotal = (orderData.order_items || []).reduce(
    (soma: number, item: any) => soma + (typeof item.sale_fee === 'number' ? item.sale_fee : 0),
    0
  )

  // ── Custo de frete real ──
  let custoFrete = 0
  if (orderData.shipping?.id) {
    custoFrete = await buscarCustoFrete(orderData.shipping.id, accessToken)
  }

  const order = {
  order_id_meli: orderIdStr,
  conta_id: conta.id,
  data_venda: orderData.date_created,
  status_pedido: orderData.status,
  valor_total: orderData.total_amount,
  taxa_ml: taxaMlTotal,
  custo_frete: custoFrete
  }

  if (atomicStock) {
    const items = []
    if (orderData.status === 'paid') {
      if (!Array.isArray(orderData.order_items) || orderData.order_items.length === 0) {
        throw new Error('missing_sale_items')
      }
      for (const line of orderData.order_items) {
        if (typeof line.item?.id !== 'string' || !Number.isSafeInteger(line.quantity) || line.quantity <= 0) {
          throw new Error('invalid_sale_item')
        }
        const { data: listing, error: listingError } = await supabase.from('meli_anuncios')
          .select('id').eq('conta_id', conta.id).eq('item_id_meli', line.item.id).single()
        if (listingError || !listing) throw new Error('sale_listing_unavailable')

        const links = supabase.from('anuncio_skus').select('id').eq('anuncio_id', listing.id)
        const variation = line.item.variation_id
        const { data: sku, error: skuError } = await (variation == null
          ? links.is('variacao_id_meli', null)
          : links.eq('variacao_id_meli', String(variation))).single()
        if (skuError || !sku) throw new Error('sale_sku_unavailable')
        items.push({ sku_id: sku.id, quantity: line.quantity })
      }
    }
    const { error } = await supabase.rpc('apply_meli_sale_order', { p_order: order, p_items: items })
    if (error) throw new Error('atomic_order_update_failed')
    return
  }

  const { data: pedidoSalvo, error: pedidoError } = await supabase
    .from('pedidos')
    .upsert(order, { onConflict: 'order_id_meli' })
    .select('id')
    .single()

  if (pedidoError || !pedidoSalvo) {
    console.error("❌ Erro ao salvar pedido no Supabase:", pedidoError)
    return
  }

  if (!Array.isArray(orderData.order_items) || (conta.revisar_vinculos && orderData.status !== 'paid')) return

  for (const orderItem of orderData.order_items) {
    const itemIdMeli = orderItem.item?.id
    const qtdVendida = orderItem.quantity

    if (!itemIdMeli) continue

    const { data: anuncio } = await supabase
      .from('meli_anuncios')
      .select('id')
      .eq('item_id_meli', itemIdMeli)
      .eq('conta_id', conta.id)
      .single()

    if (!anuncio) continue

    const links = supabase.from('anuncio_skus').select('id, produto_interno_id').eq('anuncio_id', anuncio.id)
    const variation = orderItem.item?.variation_id
    const filter = !conta.revisar_vinculos ? links : variation == null
      ? links.is('variacao_id_meli', null) : links.eq('variacao_id_meli', String(variation))
    const { data: ligacao } = await filter.single()
    if (!ligacao || !ligacao.produto_interno_id) continue

    const { error: insertError } = await supabase.from('itens_pedido').insert({
      pedido_id: pedidoSalvo.id,
      anuncio_sku_id: ligacao.id,
      quantidade_vendida: qtdVendida
    })

    if (insertError) {
      if (insertError.code === '23505') {
        console.log(`⏭️ Pedido ${orderIdStr} / item ${itemIdMeli} já processado antes. Pulando baixa de estoque.`)
      } else {
        console.error('❌ Erro ao inserir item do pedido:', insertError)
      }
      continue
    }

    const { data: produto } = await supabase
      .from('produtos_internos')
      .select('id, tipo, estoque_fisico')
      .eq('id', ligacao.produto_interno_id)
      .single()

    if (!produto) continue

    if (produto.tipo === 'SIMPLES' || !produto.tipo) {
      await supabase.rpc('decrementar_estoque', {
        p_produto_id: produto.id,
        p_quantidade: qtdVendida
      })
      await supabase.from('estoque_movimentos').insert({
        produto_id: produto.id,
        delta: -qtdVendida,
        origem: 'venda_ml',
        pedido_id_meli: orderIdStr
      })
      console.log(`✅ Baixa SIMPLES feita: -${qtdVendida} no produto ${produto.id}.`)
    } else if (produto.tipo === 'KIT') {
      const { data: composicao } = await supabase
        .from('composicao_kits')
        .select('sku_simples_id, quantidade_necessaria')
        .eq('sku_kit_id', produto.id)

      if (composicao && composicao.length > 0) {
        for (const itemDaReceita of composicao) {
          const qtdParaBaixar = qtdVendida * itemDaReceita.quantidade_necessaria
          await supabase.rpc('decrementar_estoque', {
            p_produto_id: itemDaReceita.sku_simples_id,
            p_quantidade: qtdParaBaixar
          })
          await supabase.from('estoque_movimentos').insert({
            produto_id: itemDaReceita.sku_simples_id,
            delta: -qtdParaBaixar,
            origem: 'kit_composicao',
            pedido_id_meli: orderIdStr
          })
        }
        console.log(`✅ Baixa de KIT feita para o pedido ${orderIdStr}.`)
      }
    }
  }
}
