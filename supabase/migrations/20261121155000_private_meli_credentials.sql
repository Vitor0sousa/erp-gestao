begin;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table private.meli_credentials (
  conta_id uuid primary key references public.meli_contas(id) on delete cascade,
  access_token text not null check (length(btrim(access_token)) > 0),
  refresh_token text not null check (length(btrim(refresh_token)) > 0),
  token_expires_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table private.meli_credentials enable row level security;
revoke all on private.meli_credentials from public, anon, authenticated;

create function public.get_meli_credentials(p_conta_id uuid)
returns table (access_token text, refresh_token text, token_expires_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select c.access_token, c.refresh_token, c.token_expires_at
  from private.meli_credentials c
  where c.conta_id = p_conta_id;
$$;

create function public.save_meli_credentials(
  p_conta_id uuid,
  p_access_token text,
  p_refresh_token text,
  p_token_expires_at timestamptz
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into private.meli_credentials (conta_id, access_token, refresh_token, token_expires_at)
  values (p_conta_id, p_access_token, p_refresh_token, p_token_expires_at)
  on conflict (conta_id) do update
    set access_token = excluded.access_token,
        refresh_token = excluded.refresh_token,
        token_expires_at = excluded.token_expires_at,
        updated_at = now();
$$;

revoke all on function public.get_meli_credentials(uuid) from public, anon, authenticated;
revoke all on function public.save_meli_credentials(uuid, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.get_meli_credentials(uuid) to service_role;
grant execute on function public.save_meli_credentials(uuid, text, text, timestamptz)
  to service_role;

commit;
