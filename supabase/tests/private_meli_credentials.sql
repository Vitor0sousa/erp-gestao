begin;

do $$
declare
  app_role name;
begin
  foreach app_role in array array['anon', 'authenticated']::name[] loop
    if has_schema_privilege(app_role, 'private', 'USAGE')
       or has_table_privilege(app_role, 'private.meli_credentials', 'SELECT')
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

set local role service_role;

select public.save_meli_credentials('00000000-0000-4000-8000-0000000000a1', 'a1', 'ra1', null);
select public.save_meli_credentials('00000000-0000-4000-8000-0000000000b1', 'b1', 'rb1', null);
select public.save_meli_credentials('00000000-0000-4000-8000-0000000000a1', 'a2', 'ra2', null);

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
