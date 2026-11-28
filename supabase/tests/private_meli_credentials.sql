begin;

do $$
declare
  app_role name;
begin
  foreach app_role in array array['anon', 'authenticated']::name[] loop
    if has_schema_privilege(app_role, 'private', 'USAGE')
       or has_table_privilege(app_role, 'private.meli_credentials', 'SELECT')
       or has_column_privilege(app_role, 'public.meli_contas', 'access_token', 'SELECT')
       or has_column_privilege(app_role, 'public.meli_contas', 'refresh_token', 'SELECT')
       or has_column_privilege(app_role, 'public.meli_contas', 'refresh_token', 'UPDATE')
       or has_table_privilege(app_role, 'public.meli_contas', 'DELETE')
       or has_function_privilege(app_role, 'public.get_meli_credentials(uuid)', 'EXECUTE')
       or has_function_privilege(app_role,
         'public.save_meli_credentials(uuid,text,text,timestamptz)', 'EXECUTE') then
      raise exception 'Acesso inesperado para %', app_role;
    end if;
  end loop;
end $$;

insert into public.meli_contas (id, nome_conta, seller_id_meli, access_token, refresh_token, updated_at)
values
  ('00000000-0000-4000-8000-0000000000a1', 'Conta teste A', 'test-a', 'legacy-a', 'legacy-a', now()),
  ('00000000-0000-4000-8000-0000000000b1', 'Conta teste B', 'test-b', 'legacy-b', 'legacy-b', now());

set local role authenticated;

select id, nome_conta, seller_id_meli from public.meli_contas where false;

set local role service_role;

update public.meli_contas
set access_token = 'legacy-rotated-a', refresh_token = 'legacy-rotated-a'
where id = '00000000-0000-4000-8000-0000000000a1';

do $$
begin
  if (select access_token from public.get_meli_credentials('00000000-0000-4000-8000-0000000000a1'))
       is distinct from 'legacy-rotated-a'
     or (select refresh_token from public.get_meli_credentials('00000000-0000-4000-8000-0000000000b1'))
       is distinct from 'legacy-b' then
    raise exception 'Rotação legada não foi espelhada na conta correta';
  end if;
end $$;

select public.save_meli_credentials('00000000-0000-4000-8000-0000000000a1', 'a1', 'ra1', null);
select public.save_meli_credentials('00000000-0000-4000-8000-0000000000b1', 'b1', 'rb1', null);
select public.save_meli_credentials('00000000-0000-4000-8000-0000000000a1', 'a2', 'ra2', null);

update public.meli_contas
set access_token = 'legacy-stale-a', refresh_token = 'legacy-stale-a'
where id = '00000000-0000-4000-8000-0000000000a1';

do $$
begin
  if (select access_token from public.get_meli_credentials('00000000-0000-4000-8000-0000000000a1'))
       is distinct from 'a2'
     or (select refresh_token from public.get_meli_credentials('00000000-0000-4000-8000-0000000000b1'))
       is distinct from 'rb1' then
    raise exception 'Credenciais incorretas ou cruzadas entre contas';
  end if;
end $$;

rollback;
