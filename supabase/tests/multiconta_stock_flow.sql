-- Run after fixtures/multiconta_legacy.sql and all multiconta migrations.
begin;

insert into public.produtos_internos values ('00000000-0000-4000-8000-000000000003', 'SIMPLES', 10);
insert into public.meli_anuncios values
  ('00000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000001'),
  ('00000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-000000000002');
insert into public.anuncio_skus values
  ('00000000-0000-4000-8000-000000000006', '00000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000003'),
  ('00000000-0000-4000-8000-000000000007', '00000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-000000000003');

set local role service_role;

do $$
declare
  seller record;
  notification record;
  stock_event record;
  expected_stock integer := 10;
  order_number integer := 200;
  header jsonb;
  lines jsonb;
begin
  for seller in
    select c.id, c.seller_id_meli, sku.id as sku_id, sku.produto_interno_id
    from public.meli_contas c
    join public.meli_anuncios a on a.conta_id = c.id
    join public.anuncio_skus sku on sku.anuncio_id = a.id
    order by c.seller_id_meli
  loop
    order_number := order_number + 1;
    if (select access_token from public.get_meli_credentials(seller.id))
      is distinct from (case seller.seller_id_meli when '101' then 'test-a' else 'test-b' end) then
      raise exception 'Credencial de teste incorreta';
    end if;

    perform public.enqueue_meli_notification(seller.seller_id_meli, 'orders_v2', '/orders/' || order_number);
    select * into strict notification from public.claim_meli_notification();
    if notification.seller_id <> seller.seller_id_meli then raise exception 'Seller incorreto na fila'; end if;

    header := jsonb_build_object(
      'order_id_meli', order_number::text, 'conta_id', seller.id, 'data_venda', now(),
      'status_pedido', 'paid', 'valor_total', 100
    );
    lines := jsonb_build_array(jsonb_build_object('sku_id', seller.sku_id, 'quantity', 2));
    if public.apply_meli_sale_order(header, lines) <> 1
      or public.apply_meli_sale_order(header, lines) <> 0 then
      raise exception 'Venda ou reenvio não processado como esperado';
    end if;

    if not public.finish_meli_notification(notification.event_id::bigint, notification.lease_token, true) then
      raise exception 'Falha ao concluir evento da venda';
    end if;

    expected_stock := expected_stock - 2;
    if (select estoque_fisico from public.produtos_internos where id = seller.produto_interno_id)
      is distinct from expected_stock then raise exception 'Saldo central incorreto'; end if;

    select * into strict stock_event from public.claim_meli_stock_change();
    if stock_event.product_id <> seller.produto_interno_id
      or not public.finish_meli_stock_change(stock_event.event_id::bigint, stock_event.lease_token, true) then
      raise exception 'Evento de estoque incorreto';
    end if;
  end loop;

  if expected_stock <> 6 or (select count(*) from public.estoque_movimentos) <> 2
    or exists (select 1 from public.claim_meli_stock_change()) then
    raise exception 'Baixas ou estado final da fila incorretos';
  end if;
end;
$$;

rollback;
