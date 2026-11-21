const encoder = new TextEncoder();

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export function newOAuthState(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(32)));
}

export async function hashOAuthState(state: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(state)));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
}

// The callback can derive the same verifier without storing it in the database.
export async function meliCodeVerifier(state: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  return base64url(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(state))));
}

export async function meliCodeChallenge(verifier: string): Promise<string> {
  return base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(verifier))));
}
