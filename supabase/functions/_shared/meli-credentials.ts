import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

interface Credentials {
  access_token: string;
  refresh_token: string;
}

export async function loadMeliCredentials(
  supabase: SupabaseClient,
  accountId: string,
  privateMode: boolean,
): Promise<Credentials> {
  const { data, error } = privateMode
    ? await supabase.rpc("get_meli_credentials", { p_conta_id: accountId }).single<Credentials>()
    : await supabase.from("meli_contas").select("access_token,refresh_token")
      .eq("id", accountId).single<Credentials>();
  if (error || !data?.access_token || !data.refresh_token) {
    throw new Error("meli_credentials_unavailable");
  }
  return data;
}

export async function refreshMeliCredentials(
  supabase: SupabaseClient,
  accountId: string,
  privateMode: boolean,
  refreshToken: string,
): Promise<string> {
  const clientId = Deno.env.get("MELI_CLIENT_ID");
  const clientSecret = Deno.env.get("MELI_CLIENT_SECRET");
  if (!clientId || !clientSecret) throw new Error("missing_meli_refresh_configuration");

  const response = await fetch("https://api.mercadolibre.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
    }),
  });
  if (!response.ok) throw new Error(`meli_refresh_http_${response.status}`);

  const tokens = await response.json();
  const accessToken = tokens.access_token;
  const nextRefreshToken = tokens.refresh_token;
  if (typeof accessToken !== "string" || !accessToken.trim()
    || typeof nextRefreshToken !== "string" || !nextRefreshToken.trim()) {
    throw new Error("meli_refresh_invalid_response");
  }

  const expiresIn = Number(tokens.expires_in);
  const expiresAt = Number.isFinite(expiresIn) && expiresIn > 0
    ? new Date(Date.now() + expiresIn * 1000).toISOString()
    : null;
  const { error } = privateMode
    ? await supabase.rpc("save_meli_credentials", {
      p_conta_id: accountId,
      p_access_token: accessToken,
      p_refresh_token: nextRefreshToken,
      p_token_expires_at: expiresAt,
    })
    : await supabase.from("meli_contas").update({
      access_token: accessToken,
      refresh_token: nextRefreshToken,
      updated_at: new Date().toISOString(),
    }).eq("id", accountId);
  if (error) throw new Error("meli_refresh_save_failed");
  return accessToken;
}
