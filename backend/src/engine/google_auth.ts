/**
 * Token de acceso de Google Cloud a partir de una cuenta de servicio (archivo JSON).
 *
 * La API de Vertex AI compatible con OpenAI no acepta API keys: pide un token OAuth que dura
 * una hora. Aquí se firma un JWT con la clave privada de la cuenta de servicio, se cambia por
 * un token en oauth2.googleapis.com y se reutiliza hasta poco antes de que venza.
 */

export interface ServiceAccount {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

const SCOPE = "https://www.googleapis.com/auth/cloud-platform";
const DEFAULT_TOKEN_URI = "https://oauth2.googleapis.com/token";
/** Se pide un token nuevo cuando al actual le quedan menos de 5 minutos. */
const REFRESH_MARGIN_MS = 5 * 60_000;

export function parseServiceAccount(text: string): ServiceAccount {
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("el archivo de la cuenta de servicio no es JSON válido");
  }
  if (typeof data.client_email !== "string" || typeof data.private_key !== "string") {
    throw new Error(
      "el archivo no parece una clave de cuenta de servicio (faltan client_email o private_key)",
    );
  }
  return {
    client_email: data.client_email,
    private_key: data.private_key,
    token_uri: typeof data.token_uri === "string" ? data.token_uri : undefined,
  };
}

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64urlJson = (v: unknown) => b64url(new TextEncoder().encode(JSON.stringify(v)));

async function importKey(pem: string): Promise<CryptoKey> {
  const body = pem.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  return await crypto.subtle.importKey(
    "pkcs8",
    der,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

/** JWT firmado (RS256) que se cambia por un token de acceso. */
export async function signAssertion(sa: ServiceAccount, nowMs: number): Promise<string> {
  const iat = Math.floor(nowMs / 1000);
  const unsigned = `${b64urlJson({ alg: "RS256", typ: "JWT" })}.${
    b64urlJson({
      iss: sa.client_email,
      scope: SCOPE,
      aud: sa.token_uri ?? DEFAULT_TOKEN_URI,
      iat,
      exp: iat + 3600,
    })
  }`;
  const key = await importKey(sa.private_key);
  const sig = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(unsigned),
  );
  return `${unsigned}.${b64url(new Uint8Array(sig))}`;
}

export interface TokenSource {
  /** Token vigente; pide uno nuevo si no hay o está por vencer. */
  token(fetchFn?: typeof fetch): Promise<string>;
  /** Olvida el token guardado (por ejemplo, tras un 401). */
  reset(): void;
}

export function serviceAccountTokenSource(
  loadAccount: () => Promise<ServiceAccount>,
  now: () => number = Date.now,
): TokenSource {
  let cached: { value: string; expiresAt: number } | null = null;
  let pending: Promise<string> | null = null;

  async function fetchToken(fetchFn: typeof fetch): Promise<string> {
    const sa = await loadAccount();
    const assertion = await signAssertion(sa, now());
    const res = await fetchFn(sa.token_uri ?? DEFAULT_TOKEN_URI, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || typeof data?.access_token !== "string") {
      const reason = data?.error_description ?? data?.error ?? `HTTP ${res.status}`;
      throw new Error(`Google no entregó un token de acceso: ${reason}`);
    }
    cached = {
      value: data.access_token,
      expiresAt: now() + Number(data.expires_in ?? 3600) * 1000,
    };
    return data.access_token;
  }

  return {
    token(fetchFn = fetch) {
      if (cached && cached.expiresAt - now() > REFRESH_MARGIN_MS) {
        return Promise.resolve(cached.value);
      }
      // Si varias llamadas piden token a la vez, comparten la misma solicitud.
      pending ??= fetchToken(fetchFn).finally(() => (pending = null));
      return pending;
    },
    reset() {
      cached = null;
    },
  };
}
