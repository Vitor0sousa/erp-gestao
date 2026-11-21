begin;

alter table private.integration_inbox add column lease_token uuid;
create index integration_inbox_expired_idx on private.integration_inbox (locked_until, id)
  where status = 'processing';

create function public.claim_meli_notification()
returns table (event_id text, seller_id text, topic text, resource text, lease_token uuid)
language sql security definer set search_path = ''
as $$
  with expired as (
    update private.integration_inbox q
    set status = 'dead', locked_until = null, lease_token = null, processed_at = now()
    where q.provider = 'mercado_livre' and q.status = 'processing' and q.locked_until <= now() and q.attempts >= 5
  ), candidate as (
    select q.id from private.integration_inbox q
    where q.provider = 'mercado_livre' and q.attempts < 5 and (
      (q.status in ('pending', 'retry') and q.available_at <= now())
      or (q.status = 'processing' and q.locked_until <= now())
    )
    order by q.available_at, q.id
    for update skip locked limit 1
  )
  update private.integration_inbox q
  set status = 'processing', attempts = q.attempts + 1,
      lease_token = gen_random_uuid(), locked_until = now() + interval '5 minutes'
  from candidate
  where q.id = candidate.id
  returning q.id::text, q.seller_external_id, q.topic, q.resource, q.lease_token;
$$;

create function public.finish_meli_notification(p_event_id bigint, p_lease_token uuid, p_success boolean)
returns boolean
language sql security definer set search_path = ''
as $$
  with completed as (
    update private.integration_inbox q
    set status = case when p_success then 'done' when q.attempts >= 5 then 'dead' else 'retry' end,
        available_at = now() + interval '30 seconds' * power(2, q.attempts - 1),
        processed_at = case when p_success or q.attempts >= 5 then now() else null end,
        lease_token = null, locked_until = null
    where q.id = p_event_id and q.provider = 'mercado_livre' and q.status = 'processing'
      and q.lease_token = p_lease_token and q.locked_until > now()
    returning 1
  )
  select exists (select 1 from completed);
$$;

revoke all on function public.claim_meli_notification() from public, anon, authenticated;
revoke all on function public.finish_meli_notification(bigint, uuid, boolean) from public, anon, authenticated;
grant execute on function public.claim_meli_notification() to service_role;
grant execute on function public.finish_meli_notification(bigint, uuid, boolean) to service_role;

commit;
