begin;

alter table private.stock_outbox
  add column attempts integer not null default 0,
  add column available_at timestamptz not null default now(),
  add column lease_token uuid,
  add column locked_until timestamptz,
  add column failed_at timestamptz;

create function public.claim_meli_stock_change()
returns table (event_id text, product_id uuid, lease_token uuid)
language plpgsql security definer set search_path = ''
as $$
begin
  -- Serialize workers, including writes to different variations of the same listing.
  if not pg_catalog.pg_try_advisory_xact_lock(76151, 1) then return; end if;

  if exists (
    select 1 from pg_catalog.pg_trigger
    where tgrelid = 'public.produtos_internos'::regclass
      and tgname = 'Update_stock' and tgenabled <> 'D'
  ) then
    raise exception 'Publicação legada ainda habilitada';
  end if;

  if exists (select 1 from private.stock_outbox q where q.locked_until > now()) then return; end if;

  update private.stock_outbox q
  set failed_at = now(), lease_token = null, locked_until = null
  where q.processed_at is null and q.failed_at is null and q.attempts >= 5
    and q.locked_until <= now();

  return query
  with candidate as (
    select q.id from private.stock_outbox q
    where q.processed_at is null and q.failed_at is null and q.available_at <= now()
      and not exists (
        select 1 from private.stock_outbox newer
        where newer.produto_id = q.produto_id and newer.id > q.id
      )
    order by q.id
    for update skip locked limit 1
  )
  update private.stock_outbox q
  set lease_token = gen_random_uuid(), locked_until = now() + interval '5 minutes',
      attempts = q.attempts + 1
  from candidate where q.id = candidate.id
  returning q.id::text, q.produto_id, q.lease_token;
end;
$$;

create function public.finish_meli_stock_change(p_event_id bigint, p_lease_token uuid, p_success boolean)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  product_id uuid;
begin
  update private.stock_outbox q
  set processed_at = case when p_success then now() end,
      failed_at = case when not p_success and q.attempts >= 5 then now() end,
      available_at = now() + interval '30 seconds' * power(2, q.attempts - 1),
      lease_token = null, locked_until = null
  where q.id = p_event_id and q.lease_token = p_lease_token and q.locked_until > now()
  returning q.produto_id into product_id;
  if not found then return false; end if;

  if p_success then
    update private.stock_outbox q set processed_at = now(), lease_token = null, locked_until = null
    where q.produto_id = product_id and q.id < p_event_id and q.processed_at is null
      and q.failed_at is null;
  end if;
  return true;
end;
$$;

revoke all on function public.claim_meli_stock_change() from public, anon, authenticated;
revoke all on function public.finish_meli_stock_change(bigint, uuid, boolean) from public, anon, authenticated;
grant execute on function public.claim_meli_stock_change() to service_role;
grant execute on function public.finish_meli_stock_change(bigint, uuid, boolean) to service_role;

commit;
