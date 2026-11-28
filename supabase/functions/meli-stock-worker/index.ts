import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { loadMeliCredentials, refreshMeliCredentials } from "../_shared/meli-credentials.ts";

interface StockJob {
  event_id: string;
  product_id: string;
  lease_token: string;
}

interface ListingLink {
  variacao_id_meli: string | null;
  meli_anuncios: { item_id_meli: string; conta_id: string } | null;
}

serve(async (req) => {
  if (req.method !== "POST") return new Response("Apenas POST", { status: 405 });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return new Response("Configuração indisponível", { status: 503 });

  const authorization = req.headers.get("Authorization");
  if (!authorization || !/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/i.test(authorization)) {
    return new Response("Acesso restrito ao serviço", { status: 401 });
  }

  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!anonKey) return new Response("Configuração indisponível", { status: 503 });

  // PostgREST validates the caller's JWT and applies its database role.
  const caller = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });
  const permission = await caller.rpc("check_meli_stock_worker_role");
  if (permission.error && ![401, 403].includes(permission.status)) {
    return new Response("Validação de acesso indisponível", { status: 503 });
  }
  if (permission.data !== true || permission.error) {
    return new Response("Acesso restrito ao serviço", { status: 401 });
  }
  if (Deno.env.get("STOCK_OUTBOX_ENABLED") !== "true") {
    return new Response("Worker desativado", { status: 503 });
  }

  const privateMode = Deno.env.get("MELI_PRIVATE_CREDENTIALS_ENABLED") === "true";
  const supabase = createClient(supabaseUrl, serviceKey);
  try {
    const { data: job, error } = await supabase.rpc("claim_meli_stock_change").maybeSingle<StockJob>();
    if (error) return new Response("Fila indisponível", { status: 503 });
    if (!job) return new Response(null, { status: 204 });

    let result: Response;
    try {
      result = await publishProduct(supabase, job, privateMode);
    } catch {
      result = new Response("Falha ao publicar estoque", { status: 502 });
    }
    const lease = { p_event_id: job.event_id, p_lease_token: job.lease_token };
    const completed = result.status === 429
      ? await supabase.rpc("defer_meli_stock_change", {
        ...lease, p_delay_seconds: Number(result.headers.get("Retry-After")),
      })
      : await supabase.rpc("finish_meli_stock_change", { ...lease, p_success: result.ok });
    return completed.error || completed.data !== true
      ? new Response("Falha ao registrar resultado da fila", { status: 503 })
      : result;
  } catch {
    return new Response("Falha ao processar atualização de estoque", { status: 500 });
  }
});

async function publishProduct(
  supabase: SupabaseClient,
  job: StockJob,
  privateMode: boolean,
): Promise<Response> {
  const [productResult, linksResult, progressResult] = await Promise.all([
    supabase.from("produtos_internos").select("estoque_fisico").eq("id", job.product_id).maybeSingle(),
    supabase.from("anuncio_skus").select("variacao_id_meli,meli_anuncios(item_id_meli,conta_id)")
      .eq("produto_interno_id", job.product_id).returns<ListingLink[]>(),
    supabase.rpc("list_meli_stock_progress", { p_event_id: job.event_id })
      .returns<{ listing_key: string; stock: unknown }[]>(),
  ]);
  if (productResult.error || linksResult.error || progressResult.error) {
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

  const canonical = (value: unknown): string => JSON.stringify(value, (_key, entry) =>
    entry && typeof entry === "object" && !Array.isArray(entry)
      ? Object.fromEntries(Object.entries(entry).sort(([a], [b]) => a.localeCompare(b)))
      : entry
  );
  const progress = new Map((progressResult.data ?? [])
    .map(entry => [entry.listing_key, canonical(entry.stock)]));
  let nextRequest = 0;
  const requestMarketplace = async (url: string, options: RequestInit) => {
    const delay = nextRequest - Date.now();
    if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
    nextRequest = Date.now() + 600;
    return await fetch(url, options);
  };
  let failed = 0;
  let published = 0;
  let skippedDeleted = 0;
  let resumed = 0;
  for (const [key, { conta_id, item_id_meli, variations }] of listings) {
    try {
      const variationIds = [...variations].map(Number).sort((a, b) => a - b);
      if (variationIds.some(id => !Number.isSafeInteger(id) || id <= 0)) {
        throw new Error("invalid_meli_variation_id");
      }
      const stock = variationIds.length
        ? { variations: variationIds.map(id => ({ id, available_quantity: quantity })) }
        : { available_quantity: quantity };
      if (progress.get(key) === canonical(stock)) {
        resumed++;
        continue;
      }
      const checkpoint = async () => {
        const { data, error } = await supabase.rpc("save_meli_stock_progress", {
          p_event_id: job.event_id, p_lease_token: job.lease_token, p_listing_key: key, p_stock: stock,
        });
        if (error || data !== true) throw new Error("stock_checkpoint_failed");
      };
      const credentials = await loadMeliCredentials(supabase, conta_id, privateMode);
      const publish = (token: string) =>
        requestMarketplace(`https://api.mercadolibre.com/items/${encodeURIComponent(item_id_meli)}`, {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(stock),
          signal: AbortSignal.timeout(15000),
        });

      let token = credentials.access_token;
      let response = await publish(token);
      if (response.status === 401) {
        token = await refreshMeliCredentials(supabase, conta_id, privateMode, credentials.refresh_token);
        response = await publish(token);
      }
      if (response.status === 429) {
        const header = response.headers.get("Retry-After") ?? "";
        const seconds = /^\d+$/.test(header) ? Number(header) : (Date.parse(header) - Date.now()) / 1000;
        const delay = Number.isFinite(seconds) ? Math.min(86400, Math.max(60, Math.ceil(seconds))) : 90;
        console.warn("Limite do Mercado Livre ao publicar estoque", item_id_meli, delay);
        return Response.json({ published, failed, skipped_deleted: skippedDeleted, resumed }, {
          status: 429, headers: { "Retry-After": String(delay) },
        });
      }
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        const code = typeof body?.error === "string" && /^[A-Za-z0-9_.-]{1,80}$/.test(body.error)
          ? body.error
          : "unknown";
        const causes = Array.isArray(body?.cause)
          ? body.cause.slice(0, 5).map((cause: { code?: unknown }) => cause?.code)
            .filter((value: unknown) => typeof value === "string" && /^[A-Za-z0-9_.-]{1,80}$/.test(value))
          : [];
        if (response.status === 400 && causes.includes("field_not_updatable")) {
          const itemResponse = await requestMarketplace(
            `https://api.mercadolibre.com/items/${encodeURIComponent(item_id_meli)}?attributes=id,status,sub_status`,
            { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8000) },
          );
          const item = itemResponse.ok ? await itemResponse.json().catch(() => null) : null;
          if (item?.id === item_id_meli && item.status === "inactive"
            && Array.isArray(item.sub_status) && item.sub_status.includes("deleted")) {
            await checkpoint();
            skippedDeleted++;
            console.info("Anúncio excluído ignorado na publicação", item_id_meli);
            continue;
          }
        }
        failed++;
        console.error("Mercado Livre recusou saldo do anúncio", item_id_meli, response.status, code, causes);
        continue;
      }
      await checkpoint();
      published++;
    } catch {
      failed++;
      console.error("Falha ao publicar saldo do anúncio", item_id_meli);
    }
  }

  return Response.json(
    { published, failed, skipped_deleted: skippedDeleted, resumed },
    { status: failed ? 502 : 200 },
  );
}
