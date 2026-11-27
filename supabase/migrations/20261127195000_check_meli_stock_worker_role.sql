begin;

create function public.check_meli_stock_worker_role()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select current_user = 'service_role';
$$;

revoke all on function public.check_meli_stock_worker_role() from public, anon, authenticated;
grant execute on function public.check_meli_stock_worker_role() to service_role;

commit;
