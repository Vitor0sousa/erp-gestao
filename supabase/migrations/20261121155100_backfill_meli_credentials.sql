begin;

-- Preserve account IDs and any credentials already written by the new backend.
-- Legacy writers must be stopped before switching readers to the private table.
insert into private.meli_credentials (conta_id, access_token, refresh_token, updated_at)
select id, access_token, refresh_token, updated_at
from public.meli_contas
where access_token is not null and refresh_token is not null
on conflict (conta_id) do nothing;

commit;
