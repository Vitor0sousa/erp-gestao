begin;

-- New authorizations store credentials exclusively in the private table.
alter table public.meli_contas
  alter column access_token drop not null,
  alter column refresh_token drop not null;

create function public.connect_meli_account(
  p_seller_id text, p_store_name text, p_access_token text,
  p_refresh_token text, p_token_expires_at timestamptz
)
returns uuid
language plpgsql security invoker set search_path = ''
as $$
declare
  account_id uuid;
begin
  if p_seller_id is null or p_seller_id !~ '^[0-9]{1,30}$'
    or p_store_name is null or btrim(p_store_name) = '' then
    raise exception 'Identificação da loja inválida';
  end if;

  insert into public.meli_contas (seller_id_meli, nome_conta, updated_at)
  values (p_seller_id, p_store_name, now())
  on conflict (seller_id_meli) do update set
    updated_at = now()
  returning id into account_id;

  perform public.save_meli_credentials(account_id, p_access_token, p_refresh_token, p_token_expires_at);
  return account_id;
end;
$$;

revoke all on function public.connect_meli_account(text, text, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.connect_meli_account(text, text, text, text, timestamptz)
  to service_role;

commit;
