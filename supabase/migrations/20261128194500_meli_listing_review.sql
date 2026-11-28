begin;

alter table public.meli_contas add column revisar_vinculos boolean not null default true;
update public.meli_contas set revisar_vinculos = false
where access_token is not null and refresh_token is not null;

alter table public.meli_anuncios
  add column sku_marketplace text,
  add column variacoes_marketplace jsonb not null default '[]'::jsonb;

create function public.salvar_vinculo_meli(
  p_anuncio_id uuid, p_variacao_id text, p_produto_id uuid, p_vinculo_esperado uuid,
  p_produto_esperado uuid
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  anuncio public.meli_anuncios%rowtype;
  vinculo public.anuncio_skus%rowtype;
  quantidade bigint;
begin
  select * into anuncio from public.meli_anuncios where id = p_anuncio_id for update;
  if not found then raise exception 'Anúncio não encontrado.'; end if;

  if p_variacao_id is null then
    if jsonb_array_length(anuncio.variacoes_marketplace) > 0
      or exists (select 1 from public.anuncio_skus where anuncio_id = p_anuncio_id and variacao_id_meli is not null) then
      raise exception 'Selecione a variação do anúncio.';
    end if;
  elsif not exists (
    select 1 from jsonb_array_elements(anuncio.variacoes_marketplace) as variation
    where variation->>'id' = p_variacao_id
  ) and not exists (
    select 1 from public.anuncio_skus where anuncio_id = p_anuncio_id and variacao_id_meli = p_variacao_id
  ) then
    raise exception 'Variação não encontrada neste anúncio.';
  end if;

  select count(*) into quantidade from public.anuncio_skus
  where anuncio_id = p_anuncio_id and variacao_id_meli is not distinct from p_variacao_id;
  if quantidade > 1 then raise exception 'Este anúncio tem vínculos múltiplos e exige revisão manual.'; end if;

  select * into vinculo from public.anuncio_skus
  where anuncio_id = p_anuncio_id and variacao_id_meli is not distinct from p_variacao_id for update;

  if vinculo.id is distinct from p_vinculo_esperado
    or vinculo.produto_interno_id is distinct from p_produto_esperado then
    raise exception 'O vínculo mudou. Atualize o painel antes de tentar novamente.';
  end if;
  if vinculo.produto_interno_id = p_produto_id then return vinculo.id; end if;

  if not exists (select 1 from public.produtos_internos where id = p_produto_id) then
    raise exception 'Produto interno não encontrado.';
  end if;

  if vinculo.id is null then
    insert into public.anuncio_skus (anuncio_id, variacao_id_meli, produto_interno_id)
    values (p_anuncio_id, p_variacao_id, p_produto_id) returning id into vinculo.id;
  else
    if exists (select 1 from public.itens_pedido where anuncio_sku_id = vinculo.id) then
      raise exception 'Este vínculo tem histórico de pedidos e exige revisão manual.';
    end if;
    update public.anuncio_skus set produto_interno_id = p_produto_id where id = vinculo.id;
  end if;
  return vinculo.id;
end;
$$;

revoke execute on function public.salvar_vinculo_meli(uuid, text, uuid, uuid, uuid) from public, anon;
grant execute on function public.salvar_vinculo_meli(uuid, text, uuid, uuid, uuid) to authenticated;

commit;
