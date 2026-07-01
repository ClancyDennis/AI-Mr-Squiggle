// OpenRouter OAuth (PKCE) — lets a user tap "Connect" and authorize instead of
// pasting an API key. Framework-agnostic: the caller supplies how to open the
// browser and how the callback URL is formed (web origin vs native deep link),
// so the same flow works in the dev browser and in the native iOS app.

const AUTH_ENDPOINT = "https://openrouter.ai/auth";
const KEY_EXCHANGE_ENDPOINT = "https://openrouter.ai/api/v1/auth/keys";

export type Pkce = { verifier: string; challenge: string };

const VERIFIER_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";

function base64UrlFromBytes(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function createVerifier(length = 64): string {
  const random = new Uint8Array(length);
  crypto.getRandomValues(random);
  let out = "";
  for (const value of random) out += VERIFIER_CHARS[value % VERIFIER_CHARS.length];
  return out;
}

export async function challengeFromVerifier(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64UrlFromBytes(new Uint8Array(digest));
}

export async function createPkce(): Promise<Pkce> {
  const verifier = createVerifier();
  const challenge = await challengeFromVerifier(verifier);
  return { verifier, challenge };
}

export function buildAuthUrl(callbackUrl: string, challenge: string): string {
  const params = new URLSearchParams({
    callback_url: callbackUrl,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

// Exchanges the authorization code (plus the original verifier) for a usable
// `sk-or-v1-…` API key that belongs to the user.
export async function exchangeCodeForKey(code: string, verifier: string): Promise<string> {
  const response = await fetch(KEY_EXCHANGE_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, code_verifier: verifier, code_challenge_method: "S256" }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(detail || `OpenRouter key exchange failed (${response.status})`);
  }
  const data = (await response.json()) as { key?: unknown };
  if (typeof data.key !== "string" || !data.key) {
    throw new Error("OpenRouter did not return a key");
  }
  return data.key;
}
