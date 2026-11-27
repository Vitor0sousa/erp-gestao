begin;

create table private.stock_publication_progress (
  event_id bigint not null references private.stock_outbox(id) on delete cascade,
  listing_key text not null,
  stock jsonb not null,
  primary key (event_id, listing_key)
);

alter table private.stock_publication_progress enable row level security;
revoke all on private.stock_publication_progress from public, anon, authenticated;

create function public.list_meli_stock_progress(p_event_id bigint)
returns table (listing_key text, stock jsonb)
language sql stable security definer set search_path = ''
as $$
  select p.listing_key, p.stock
  from private.stock_publication_progress p
  where p.event_id = p_event_id;
$$;

create function public.save_meli_stock_progress(
  p_event_id bigint, p_lease_token uuid, p_listing_key text, p_stock jsonb
)
returns boolean
language plpgsql security definer set search_path = ''
as $$
begin
  perform 1 from private.stock_outbox q
  where q.id = p_event_id and q.lease_token = p_lease_token and q.locked_until > now()
  for update;
  if not found then return false; end if;

  insert into private.stock_publication_progress(event_id, listing_key, stock)
  values (p_event_id, p_listing_key, p_stock)
  on conflict (event_id, listing_key) do update set stock = excluded.stock;
  return true;
end;
$$;

create function public.defer_meli_stock_change(p_event_id bigint, p_lease_token uuid, p_delay_seconds integer)
returns boolean
language sql security definer set search_path = ''
as $$
  with deferred as (
    update private.stock_outbox q
    set available_at = now() + make_interval(secs => greatest(60, least(86400, p_delay_seconds))),
        attempts = greatest(0, q.attempts - 1),
        lease_token = null,
        locked_until = null
    where q.id = p_event_id and q.lease_token = p_lease_token and q.locked_until > now()
    returning 1
  )
  select exists(select 1 from deferred);
$$;

revoke all on function public.list_meli_stock_progress(bigint) from public, anon, authenticated;
revoke all on function public.save_meli_stock_progress(bigint, uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.defer_meli_stock_change(bigint, uuid, integer) from public, anon, authenticated;
grant execute on function public.list_meli_stock_progress(bigint) to service_role;
grant execute on function public.save_meli_stock_progress(bigint, uuid, text, jsonb) to service_role;
grant execute on function public.defer_meli_stock_change(bigint, uuid, integer) to service_role;

commit;
