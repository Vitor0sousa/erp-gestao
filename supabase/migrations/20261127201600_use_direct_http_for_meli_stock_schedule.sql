begin;

create extension if not exists http with schema extensions;

select cron.alter_job(
  job_id := (select jobid from cron.job where jobname = 'meli-stock-worker-minute'),
  active := false,
  command := $job$
    select extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS', '25000');
    select response.status
    from vault.decrypted_secrets secret
    cross join lateral extensions.http((
      'POST',
      'https://uvjadekrdvydtorcrhkd.supabase.co/functions/v1/meli-stock-worker',
      array[extensions.http_header('Authorization', 'Bearer ' || secret.decrypted_secret)],
      'application/json',
      '{}'
    )::extensions.http_request) response
    where secret.name = 'meli_stock_worker_service_jwt'
      and secret.decrypted_secret ~ '^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$';
  $job$
);

commit;
