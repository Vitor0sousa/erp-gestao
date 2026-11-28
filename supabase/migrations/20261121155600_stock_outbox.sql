begin;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table private.stock_outbox (
  id bigint generated always as identity primary key,
  produto_id uuid not null,
  estoque_fisico integer not null,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);

create index stock_outbox_pending_idx on private.stock_outbox (id)
  where processed_at is null;
create index stock_outbox_product_version_idx on private.stock_outbox (produto_id, id desc);

alter table private.stock_outbox enable row level security;
revoke all on private.stock_outbox from public, anon, authenticated;

create function private.enqueue_stock_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into private.stock_outbox (produto_id, estoque_fisico)
  values (new.id, new.estoque_fisico);
  return new;
end;
$$;

revoke all on function private.enqueue_stock_change() from public, anon, authenticated;

-- Capture changes while the legacy trigger remains responsible for publication.
create trigger trg_stock_outbox
after update of estoque_fisico on public.produtos_internos
for each row
when (old.estoque_fisico is distinct from new.estoque_fisico)
execute function private.enqueue_stock_change();

commit;
