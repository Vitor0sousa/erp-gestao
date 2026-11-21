begin;

create function public.apply_meli_sale_order(p_order jsonb, p_items jsonb)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  order_id uuid;
  item record;
  applied integer := 0;
begin
  if pg_catalog.jsonb_typeof(p_items) is distinct from 'array' then
    raise exception 'Itens do pedido inválidos';
  end if;

  if (p_order->>'status_pedido' = 'paid') is distinct from (pg_catalog.jsonb_array_length(p_items) > 0) then
    raise exception 'Pedido pago deve ter itens e outros estados não devem baixar estoque';
  end if;

  insert into public.pedidos as current_order (
    order_id_meli, conta_id, data_venda, status_pedido, valor_total, taxa_ml, custo_frete
  )
  values (
    p_order->>'order_id_meli', (p_order->>'conta_id')::uuid,
    (p_order->>'data_venda')::timestamptz, p_order->>'status_pedido',
    (p_order->>'valor_total')::numeric, (p_order->>'taxa_ml')::numeric,
    (p_order->>'custo_frete')::numeric
  )
  on conflict (order_id_meli) do update set
    status_pedido = excluded.status_pedido,
    valor_total = excluded.valor_total,
    taxa_ml = excluded.taxa_ml,
    custo_frete = excluded.custo_frete
  where current_order.conta_id = excluded.conta_id
  returning id into order_id;

  if order_id is null then
    raise exception 'Pedido pertence a outra conta';
  end if;

  -- Lock physical SKUs in one order across the entire sale, including kit components.
  perform product.id
  from public.produtos_internos product
  where product.id in (
    select link.produto_interno_id
    from pg_catalog.jsonb_to_recordset(p_items) as line(sku_id uuid)
    join public.anuncio_skus link on link.id = line.sku_id
    union
    select kit.sku_simples_id
    from pg_catalog.jsonb_to_recordset(p_items) as line(sku_id uuid)
    join public.anuncio_skus link on link.id = line.sku_id
    join public.composicao_kits kit on kit.sku_kit_id = link.produto_interno_id
  )
  order by product.id
  for no key update;

  for item in
    select line.sku_id, sum(line.quantity)::integer as quantity
    from pg_catalog.jsonb_to_recordset(p_items) as line(sku_id uuid, quantity integer)
    group by line.sku_id
    order by line.sku_id
  loop
    if public.apply_meli_sale_item(order_id, item.sku_id, item.quantity) then
      applied := applied + 1;
    end if;
  end loop;
  return applied;
end;
$$;

revoke all on function public.apply_meli_sale_order(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.apply_meli_sale_order(jsonb, jsonb) to service_role;

commit;
