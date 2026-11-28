begin;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table private.integration_oauth_sessions (
  provider text not null,
  state_hash text not null check (state_hash ~ '^[0-9a-f]{64}$'),
  user_id uuid not null,
  redirect_uri text not null,
  expires_at timestamptz not null default now() + interval '10 minutes',
  consumed_at timestamptz,
  primary key (provider, state_hash)
);

alter table private.integration_oauth_sessions enable row level security;
revoke all on private.integration_oauth_sessions from public, anon, authenticated;

create function public.create_meli_oauth_session(
  p_state_hash text, p_user_id uuid, p_redirect_uri text
)
returns void
language sql security definer set search_path = ''
as $$
  insert into private.integration_oauth_sessions (provider, state_hash, user_id, redirect_uri)
  values ('mercado_livre', p_state_hash, p_user_id, p_redirect_uri);
$$;

create function public.consume_meli_oauth_session(p_state_hash text)
returns table (user_id uuid, redirect_uri text)
language sql security definer set search_path = ''
as $$
  update private.integration_oauth_sessions s
  set consumed_at = now()
  where s.provider = 'mercado_livre' and s.state_hash = p_state_hash
    and s.expires_at > now() and s.consumed_at is null
  returning s.user_id, s.redirect_uri;
$$;

revoke all on function public.create_meli_oauth_session(text, uuid, text) from public, anon, authenticated;
revoke all on function public.consume_meli_oauth_session(text) from public, anon, authenticated;
grant execute on function public.create_meli_oauth_session(text, uuid, text) to service_role;
grant execute on function public.consume_meli_oauth_session(text) to service_role;

commit;
