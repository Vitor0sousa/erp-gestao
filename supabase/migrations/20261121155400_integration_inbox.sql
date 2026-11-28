begin;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table private.integration_inbox (
  id bigint generated always as identity primary key,
  provider text not null,
  seller_external_id text not null,
  topic text not null,
  resource text not null,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'done', 'retry', 'dead')),
  attempts integer not null default 0 check (attempts >= 0),
  available_at timestamptz not null default now(),
  locked_until timestamptz,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);

create index integration_inbox_ready_idx
  on private.integration_inbox (available_at, id)
  where status in ('pending', 'retry');

alter table private.integration_inbox enable row level security;
revoke all on private.integration_inbox from public, anon, authenticated;

create function public.enqueue_meli_notification(
  p_seller_id text,
  p_topic text,
  p_resource text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_seller_id is null or p_seller_id !~ '^[0-9]{1,30}$'
    or not coalesce(
      (p_topic = 'orders_v2' and p_resource ~ '^/orders/[0-9]{1,30}$')
      or (p_topic = 'items' and p_resource ~ '^/items/[A-Z]{3}[0-9]{1,30}$'),
      false
    ) then
    raise exception 'Notificação inválida';
  end if;

  insert into private.integration_inbox (provider, seller_external_id, topic, resource)
  select 'mercado_livre', p_seller_id, p_topic, p_resource
  where exists (select 1 from public.meli_contas where seller_id_meli = p_seller_id);
end;
$$;

revoke all on function public.enqueue_meli_notification(text, text, text)
  from public, anon, authenticated;
grant execute on function public.enqueue_meli_notification(text, text, text) to service_role;

commit;
