begin;

set local lock_timeout = '5s';

do $$
begin
  if not exists (select 1 from cron.job where jobname = 'meli-stock-worker-minute' and not active)
    or not exists (select 1 from vault.secrets where name = 'meli_stock_worker_service_jwt')
    or not exists (
      select 1 from pg_trigger
      where tgrelid = 'public.produtos_internos'::regclass
        and tgname = 'trg_stock_outbox' and tgenabled in ('O', 'A')
    )
  then
    raise exception 'Pré-condições do publicador não atendidas';
  end if;
end;
$$;

alter table public.produtos_internos disable trigger "Update_stock";
select cron.alter_job(
  (select jobid from cron.job where jobname = 'meli-stock-worker-minute'),
  active := true
);

commit;
