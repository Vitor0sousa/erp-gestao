import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { loadMeliCredentials, refreshMeliCredentials } from "../_shared/meli-credentials.ts";
import { marketplaceSkus } from "../_shared/meli-listing-skus.ts";

serve(async (req) => {
  if (req.method !== "POST") return new Response("Apenas POST permitido", { status: 405 });

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const url = Deno.env.get("SUPABASE_URL");
  // Somente outras Edge Functions do mesmo projeto podem chamar esta função.
  if (!serviceKey || !url || req.headers.get("Authorization") !== `Bearer ${serviceKey}`) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } });
  }

  try {
    const { resource, user_id } = await req.json();
    if (typeof resource !== "string" || !/^\/items\/[A-Z]{3}[0-9]+$/.test(resource)) {
      return new Response(JSON.stringify({ error: "invalid_item_resource" }), { status: 400, headers: { "Content-Type": "application/json" } });
    }
    const supabase = createClient(url, serviceKey);
    const privateCredentials = Deno.env.get("MELI_PRIVATE_CREDENTIALS_ENABLED") === "true";
    const { data: conta, error: contaError } = await supabase
      .from("meli_contas")
      .select("id,seller_id_meli,revisar_vinculos")
      .eq("seller_id_meli", String(user_id ?? ""))
      .single();
    if (contaError || !conta) return new Response(JSON.stringify({ error: "seller_not_found" }), { status: 404, headers: { "Content-Type": "application/json" } });

    const credentials = await loadMeliCredentials(supabase, conta.id, privateCredentials);
    const itemUrl = `https://api.mercadolibre.com${resource}`;
    let mlResponse = await fetch(itemUrl, {
      headers: { Authorization: `Bearer ${credentials.access_token}` },
    });
    if (mlResponse.status === 401) {
      const token = await refreshMeliCredentials(
        supabase, conta.id, privateCredentials, credentials.refresh_token,
      );
      mlResponse = await fetch(itemUrl, { headers: { Authorization: `Bearer ${token}` } });
    }
    if (!mlResponse.ok) throw new Error(`meli_item_http_${mlResponse.status}`);
    const item = await mlResponse.json();
    if (item.id !== resource.split("/")[2]) throw new Error("meli_item_id_mismatch");

    if (String(item.seller_id ?? "") !== conta.seller_id_meli) {
      throw new Error("meli_item_seller_mismatch");
    }

    const foto = item.pictures?.[0]?.secure_url || item.pictures?.[0]?.url?.replace("http://", "https://") || item.secure_thumbnail || null;
    const { data: anuncio, error: anuncioError } = await supabase.from("meli_anuncios").upsert({
      item_id_meli: item.id,
      conta_id: conta.id,
      titulo_anuncio: item.title,
      foto_url: foto,
      preco: item.price,
      status: item.status,
      ...marketplaceSkus(item)
    }, { onConflict: "item_id_meli" }).select("id").single();
    if (anuncioError || !anuncio) throw new Error("anuncio_upsert_failed");

    if (conta.revisar_vinculos) {
      return Response.json({ ok: true, item_id: item.id, anuncio_salvo: true, status: "revisar_vinculo" });
    }

    const skuAttr = item.attributes?.find((a: any) => a.id === "SELLER_SKU");
    const sku = typeof skuAttr?.value_name === "string" ? skuAttr.value_name.trim() : "";
    if (!sku) return Response.json({ ok: true, item_id: item.id, anuncio_salvo: true, status: "sem_seller_sku" });

    let { data: produto, error: lookupError } = await supabase.from("produtos_internos")
      .select("id").eq("sku_interno", sku).maybeSingle();
    if (lookupError) throw new Error("sku_lookup_failed");
    let produtoCriado = false;
    if (!produto) {
      // Espelha meli-sync: cria somente SKU inexistente; não atualiza custo/estoque de produtos existentes.
      const created = await supabase.from("produtos_internos").upsert({
        sku_interno: sku,
        nome_produto: item.title,
        tipo: "SIMPLES",
        estoque_fisico: item.available_quantity || 0
      }, { onConflict: "sku_interno", ignoreDuplicates: true }).select("id").maybeSingle();
      if (created.error) throw new Error("produto_create_failed");
      produto = created.data;
      produtoCriado = !!produto;
      if (!produto) {
        const existing = await supabase.from("produtos_internos").select("id").eq("sku_interno", sku).single();
        if (existing.error || !existing.data) throw new Error("produto_lookup_after_create_failed");
        produto = existing.data;
      }
    }

    const { data: link, error: linkError } = await supabase.from("anuncio_skus")
      .select("id,produto_interno_id").eq("anuncio_id", anuncio.id).is("variacao_id_meli", null).maybeSingle();
    if (linkError) throw new Error("link_lookup_failed");
    if (!link) {
      const { error: insertError } = await supabase.from("anuncio_skus").insert({
        anuncio_id: anuncio.id, variacao_id_meli: null, produto_interno_id: produto.id
      });
      if (insertError) throw new Error("link_insert_failed");
    }
    // Não usa PUT no Mercado Livre: esta função apenas importa para o ERP.
    return Response.json({
      ok: true, item_id: item.id, anuncio_salvo: true, sku,
      produto_criado: produtoCriado, vinculo_criado: !link,
      status: link && link.produto_interno_id !== produto.id ? "vinculo_existente_diferente" : "sincronizado"
    });
  } catch (error) {
    console.error("meli-sync-item:", error instanceof Error ? error.message : "unknown");
    return Response.json({ error: "sync_item_failed" }, { status: 500 });
  }
});
