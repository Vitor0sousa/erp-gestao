import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { hashOAuthState, meliCodeVerifier } from "../_shared/meli-oauth.ts";

serve(async (req) => {
  if (req.method !== "GET") return new Response(null, { status: 405 });

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const origin = Deno.env.get("ERP_WEB_ORIGIN");
  const manager = Deno.env.get("ERP_INTEGRATIONS_ADMIN_USER_ID");
  const clientId = Deno.env.get("MELI_CLIENT_ID");
  const clientSecret = Deno.env.get("MELI_CLIENT_SECRET");
  const pkceSecret = Deno.env.get("MELI_OAUTH_PKCE_SECRET");
  const redirectUri = Deno.env.get("MELI_OAUTH_REDIRECT_URI");
  if (!url || !serviceKey || !origin?.startsWith("https://") || !manager || !clientId
    || !clientSecret || !pkceSecret || pkceSecret.length < 32 || !redirectUri
    || Deno.env.get("MELI_PRIVATE_CREDENTIALS_ENABLED") !== "true") {
    return new Response("Integração indisponível", { status: 503 });
  }

  const headers = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };
  const redirect = (status: "connected" | "error", accountId?: string) => {
    const destination = new URL("/integracoes", origin);
    destination.searchParams.set("status", status);
    if (accountId) destination.searchParams.set("conta_id", accountId);
    return new Response(null, { status: 303, headers: { ...headers, Location: destination.href } });
  };

  try {
    const params = new URL(req.url).searchParams;
    const state = params.get("state");
    if (!state || !/^[A-Za-z0-9_-]{43}$/.test(state)) return redirect("error");

    const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });
    const { data: session, error: sessionError } = await supabase.rpc("consume_meli_oauth_session", {
      p_state_hash: await hashOAuthState(state),
    }).maybeSingle<{ user_id: string; redirect_uri: string }>();
    if (sessionError || session?.user_id !== manager || session.redirect_uri !== redirectUri) {
      return redirect("error");
    }

    const code = params.get("code");
    if (!code || params.has("error")) return redirect("error");
    const exchanged = await fetch("https://api.mercadolibre.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: session.redirect_uri,
        code_verifier: await meliCodeVerifier(state, pkceSecret),
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!exchanged.ok) return redirect("error");
    const tokens = await exchanged.json();
    const sellerId = String(tokens.user_id ?? "");
    if (!/^[0-9]{1,30}$/.test(sellerId) || typeof tokens.access_token !== "string"
      || !tokens.access_token || typeof tokens.refresh_token !== "string" || !tokens.refresh_token) {
      return redirect("error");
    }

    const currentUser = await fetch("https://api.mercadolibre.com/users/me", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!currentUser.ok) return redirect("error");
    const seller = await currentUser.json();
    if (String(seller.id) !== sellerId || typeof seller.nickname !== "string" || !seller.nickname.trim()) {
      return redirect("error");
    }

    const expiresIn = Number(tokens.expires_in);
    const expiresAt = Number.isFinite(expiresIn) && expiresIn > 0
      ? new Date(Date.now() + expiresIn * 1000).toISOString()
      : null;
    const { data: accountId, error } = await supabase.rpc("connect_meli_account", {
      p_seller_id: sellerId,
      p_store_name: seller.nickname.trim(),
      p_access_token: tokens.access_token,
      p_refresh_token: tokens.refresh_token,
      p_token_expires_at: expiresAt,
    });
    return error || typeof accountId !== "string"
      ? redirect("error")
      : redirect("connected", accountId);
  } catch {
    return redirect("error");
  }
});
