import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { hashOAuthState, meliCodeChallenge, meliCodeVerifier, newOAuthState } from "../_shared/meli-oauth.ts";

serve(async (req) => {
  const origin = Deno.env.get("ERP_WEB_ORIGIN");
  const requestOrigin = req.headers.get("Origin");
  if (!origin || requestOrigin !== origin) return new Response(null, { status: 403 });

  const headers = {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
    "Vary": "Origin",
    "Cache-Control": "no-store",
  };
  const fail = (status: number, error: string) => Response.json({ error }, { status, headers });
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (req.method !== "POST") return fail(405, "method_not_allowed");

  const token = req.headers.get("Authorization")?.match(/^Bearer (\S+)$/i)?.[1];
  if (!token) return fail(401, "unauthorized");

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const clientId = Deno.env.get("MELI_CLIENT_ID");
  const redirectUri = Deno.env.get("MELI_OAUTH_REDIRECT_URI");
  const pkceSecret = Deno.env.get("MELI_OAUTH_PKCE_SECRET");
  const manager = Deno.env.get("ERP_INTEGRATIONS_ADMIN_USER_ID");
  if (!url || !serviceKey || !clientId || !redirectUri?.startsWith("https://")
    || !pkceSecret || pkceSecret.length < 32 || !manager) {
    return fail(503, "oauth_unavailable");
  }

  try {
    const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data.user) return fail(401, "unauthorized");
    if (data.user.id !== manager) return fail(403, "forbidden");

    const state = newOAuthState();
    const challenge = await meliCodeChallenge(await meliCodeVerifier(state, pkceSecret));
    const { error: sessionError } = await supabase.rpc("create_meli_oauth_session", {
      p_state_hash: await hashOAuthState(state),
      p_user_id: data.user.id,
      p_redirect_uri: redirectUri,
    });
    if (sessionError) return fail(503, "oauth_unavailable");

    const authorize = new URL("https://auth.mercadolivre.com.br/authorization");
    authorize.search = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: redirectUri,
      state,
      code_challenge: challenge,
      code_challenge_method: "S256",
    }).toString();
    return Response.json({ authorizationUrl: authorize.href }, { headers });
  } catch {
    return fail(503, "oauth_unavailable");
  }
});
