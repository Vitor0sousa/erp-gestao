begin;

create extension if not exists pg_cron;

select cron.alter_job(
  job_id := cron.schedule(
    'meli-stock-worker-minute',
    '* * * * *',
    $job$
      select net.http_post(
        url := 'https://uvjadekrdvydtorcrhkd.supabase.co/functions/v1/meli-stock-worker',
        headers := jsonb_build_object(
          'Authorization', 'Bearer ' || secret.decrypted_secret,
          'Content-Type', 'application/json'
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 10000
      )
      from vault.decrypted_secrets secret
      where secret.name = 'meli_stock_worker_service_jwt'
        and secret.decrypted_secret ~ '^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$';
    $job$
  ),
  active := false
);

commit;
