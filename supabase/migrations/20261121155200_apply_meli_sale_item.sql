begin;

create function public.apply_meli_sale_item(
  p_pedido_id uuid,
  p_anuncio_sku_id uuid,
  p_quantidade integer
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  order_reference text;
  product_id uuid;
  product_type text;
  affected record;
  affected_count integer := 0;
begin
  if p_quantidade is null or p_quantidade <= 0 then
    raise exception 'Quantidade de venda inválida';
  end if;

  select p.order_id_meli, a.produto_interno_id, produto.tipo::text
  into strict order_reference, product_id, product_type
  from public.pedidos p
  join public.meli_anuncios listing on listing.conta_id = p.conta_id
  join public.anuncio_skus a on a.anuncio_id = listing.id
  join public.produtos_internos produto on produto.id = a.produto_interno_id
  where p.id = p_pedido_id and a.id = p_anuncio_sku_id;

  insert into public.itens_pedido (pedido_id, anuncio_sku_id, quantidade_vendida)
  values (p_pedido_id, p_anuncio_sku_id, p_quantidade)
  on conflict (pedido_id, anuncio_sku_id) do nothing;
  if not found then
    return false;
  end if;

  if product_type = 'KIT' and exists (
    select 1
    from public.composicao_kits c
    left join public.produtos_internos component on component.id = c.sku_simples_id
    where c.sku_kit_id = product_id
      and (c.quantidade_necessaria <= 0 or component.tipo::text is distinct from 'SIMPLES')
  ) then
    raise exception 'Composição de kit inválida';
  end if;

  for affected in
    select product_id as id, p_quantidade as units where product_type = 'SIMPLES'
    union all
    select c.sku_simples_id, (sum(c.quantidade_necessaria) * p_quantidade)::integer
    from public.composicao_kits c
    where product_type = 'KIT' and c.sku_kit_id = product_id
    group by c.sku_simples_id
    order by id
  loop
    update public.produtos_internos
    set estoque_fisico = estoque_fisico - affected.units
    where id = affected.id;
    if not found then
      raise exception 'Produto físico não encontrado';
    end if;

    insert into public.estoque_movimentos (produto_id, delta, origem, pedido_id_meli)
    values (
      affected.id, -affected.units,
      case when product_type = 'KIT' then 'kit_composicao' else 'venda_ml' end,
      order_reference
    );
    affected_count := affected_count + 1;
  end loop;

  if affected_count = 0 then
    raise exception 'Venda sem produto físico ou kit sem composição';
  end if;
  return true;
end;
$$;

revoke all on function public.apply_meli_sale_item(uuid, uuid, integer)
  from public, anon, authenticated;
grant execute on function public.apply_meli_sale_item(uuid, uuid, integer)
  to service_role;

commit;
