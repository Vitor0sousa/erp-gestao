-- Load only in an empty, disposable database before the multiconta migrations.
create role anon;
create role authenticated;
create role service_role;

create table public.meli_contas (
  id uuid primary key default gen_random_uuid(), nome_conta text not null, seller_id_meli text not null unique,
  access_token text not null, refresh_token text not null, updated_at timestamptz not null default now()
);
create table public.produtos_internos (
  id uuid primary key, tipo text not null, estoque_fisico integer not null
);
create table public.meli_anuncios (
  id uuid primary key, conta_id uuid not null references public.meli_contas(id)
);
create table public.anuncio_skus (
  id uuid primary key, anuncio_id uuid not null references public.meli_anuncios(id),
  produto_interno_id uuid not null references public.produtos_internos(id)
);
create table public.composicao_kits (
  sku_kit_id uuid not null, sku_simples_id uuid not null, quantidade_necessaria integer not null
);
create table public.pedidos (
  id uuid primary key default gen_random_uuid(), conta_id uuid not null references public.meli_contas(id),
  order_id_meli text not null unique, data_venda timestamptz not null, status_pedido text not null,
  valor_total numeric not null, taxa_ml numeric, custo_frete numeric
);
create table public.itens_pedido (
  pedido_id uuid not null references public.pedidos(id),
  anuncio_sku_id uuid not null references public.anuncio_skus(id),
  quantidade_vendida integer not null, unique(pedido_id, anuncio_sku_id)
);
create table public.estoque_movimentos (
  produto_id uuid not null references public.produtos_internos(id),
  delta integer not null, origem text not null, pedido_id_meli text
);
grant select, insert, update on all tables in schema public to service_role;

insert into public.meli_contas (id, nome_conta, seller_id_meli, access_token, refresh_token)
values
  ('00000000-0000-4000-8000-000000000001', 'Conta A', '101', 'test-a', 'refresh-a'),
  ('00000000-0000-4000-8000-000000000002', 'Conta B', '102', 'test-b', 'refresh-b');
