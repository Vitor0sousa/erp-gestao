begin;

set local lock_timeout = '3s';
lock table public.meli_contas in share row exclusive mode;

revoke all on table public.meli_contas from public, anon, authenticated;
grant select (id, nome_conta, seller_id_meli, updated_at)
  on public.meli_contas to authenticated;

create function private.mirror_meli_legacy_credentials()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if nullif(btrim(new.access_token), '') is null
     or nullif(btrim(new.refresh_token), '') is null then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if new.access_token is not distinct from old.access_token
       and new.refresh_token is not distinct from old.refresh_token then
      return new;
    end if;

    -- Match the previous pair so a legacy write cannot overwrite a private rotation.
    update private.meli_credentials
    set access_token = new.access_token,
        refresh_token = new.refresh_token,
        token_expires_at = null,
        updated_at = now()
    where conta_id = new.id
      and access_token = old.access_token
      and refresh_token = old.refresh_token;

    if found then
      return new;
    end if;
  end if;

  insert into private.meli_credentials (conta_id, access_token, refresh_token)
  values (new.id, new.access_token, new.refresh_token)
  on conflict (conta_id) do nothing;

  return new;
end;
$$;

revoke all on function private.mirror_meli_legacy_credentials()
  from public, anon, authenticated;

create trigger trg_mirror_meli_legacy_credentials
after insert or update of access_token, refresh_token on public.meli_contas
for each row execute function private.mirror_meli_legacy_credentials();

insert into private.meli_credentials (conta_id, access_token, refresh_token, updated_at)
select id, access_token, refresh_token, updated_at
from public.meli_contas
where nullif(btrim(access_token), '') is not null
  and nullif(btrim(refresh_token), '') is not null
on conflict (conta_id) do nothing;

commit;
