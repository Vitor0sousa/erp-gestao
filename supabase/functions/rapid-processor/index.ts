import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { loadMeliCredentials, refreshMeliCredentials } from "../_shared/meli-credentials.ts";

interface ListingLink {
  variacao_id_meli: string | null;
  meli_anuncios: { item_id_meli: string; conta_id: string } | null;
}

serve(async (req) => {
  if (req.method !== "POST") return new Response("Apenas POST", { status: 405 });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return new Response("Configuração indisponível", { status: 503 });

  const privateMode = Deno.env.get("MELI_PRIVATE_CREDENTIALS_ENABLED") === "true";
  if (privateMode && req.headers.get("Authorization") !== `Bearer ${serviceKey}`) {
    return new Response("Acesso restrito ao serviço", { status: 401 });
  }

  const outboxMode = Deno.env.get("STOCK_OUTBOX_ENABLED") === "true";
  const supabase = createClient(supabaseUrl, serviceKey);

  try {
    if (outboxMode) {
      if (req.headers.get("Authorization") !== `Bearer ${serviceKey}`) {
        return new Response("Acesso restrito ao serviço", { status: 401 });
      }
      const { data: job, error } = await supabase.rpc("claim_meli_stock_change").maybeSingle<{
        event_id: string; product_id: string; lease_token: string;
      }>();
      if (error) return new Response("Fila indisponível", { status: 503 });
      if (!job) return new Response(null, { status: 204 });

      let result: Response;
      try {
        result = await publishProduct(supabase, job.product_id, privateMode);
      } catch {
        result = new Response("Falha ao publicar estoque", { status: 502 });
      }
      const completed = await supabase.rpc("finish_meli_stock_change", {
        p_event_id: job.event_id, p_lease_token: job.lease_token, p_success: result.ok,
      });
      return completed.error || completed.data !== true
        ? new Response("Falha ao registrar resultado da fila", { status: 503 })
        : result;
    }

    const payload = await req.json().catch(() => null);
    const productId = payload?.record?.id;
    if (typeof productId !== "string") return new Response("Produto inválido", { status: 400 });
    return await publishProduct(supabase, productId, privateMode);
  } catch {
    return new Response("Falha ao processar atualização de estoque", { status: 500 });
  }
});

async function publishProduct(
  supabase: SupabaseClient,
  productId: string,
  privateMode: boolean,
): Promise<Response> {
  const [productResult, linksResult] = await Promise.all([
    supabase.from("produtos_internos").select("estoque_fisico").eq("id", productId).maybeSingle(),
    supabase.from("anuncio_skus").select("variacao_id_meli,meli_anuncios(item_id_meli,conta_id)")
      .eq("produto_interno_id", productId).returns<ListingLink[]>(),
  ]);
  if (productResult.error || linksResult.error) {
    return new Response("Falha ao consultar estoque ou anúncios", { status: 502 });
  }
  if (!productResult.data) return new Response("Produto não encontrado", { status: 404 });
  const quantity = Math.max(0, productResult.data.estoque_fisico ?? 0);

  // O mesmo saldo físico é publicado em cada anúncio vinculado.
  const listings = new Map<string, NonNullable<ListingLink["meli_anuncios"]> & { variations: Set<string> }>();
  for (const { meli_anuncios: listing, variacao_id_meli } of linksResult.data ?? []) {
    if (!listing) continue;
    const key = `${listing.conta_id}:${listing.item_id_meli}`;
    const target = listings.get(key) ?? { ...listing, variations: new Set<string>() };
    if (variacao_id_meli != null) target.variations.add(variacao_id_meli);
    listings.set(key, target);
  }

  let failed = 0;
  for (const { conta_id, item_id_meli, variations } of listings.values()) {
    try {
      const credentials = await loadMeliCredentials(supabase, conta_id, privateMode);
      const variationIds = [...variations].map(Number);
      if (variationIds.some(id => !Number.isSafeInteger(id) || id <= 0)) {
        throw new Error("invalid_meli_variation_id");
      }
      const stock = variationIds.length
        ? { variations: variationIds.map(id => ({ id, available_quantity: quantity })) }
        : { available_quantity: quantity };
      const publish = (token: string) =>
        fetch(`https://api.mercadolibre.com/items/${encodeURIComponent(item_id_meli)}`, {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(stock),
          signal: AbortSignal.timeout(15000),
        });

      let response = await publish(credentials.access_token);
      if (response.status === 401) {
        const token = await refreshMeliCredentials(supabase, conta_id, privateMode, credentials.refresh_token);
        response = await publish(token);
      }
      if (!response.ok) throw new Error("meli_stock_publish_failed");
    } catch {
      failed++;
      console.error("Falha ao publicar saldo do anúncio", item_id_meli);
    }
  }

  return Response.json({ published: listings.size - failed, failed }, { status: failed ? 502 : 200 });
}
