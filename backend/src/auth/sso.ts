/**
 * Inicio de sesión con proveedores OpenID Connect (por ahora Google).
 *
 * Flujo "authorization code" con PKCE: el navegador va al proveedor, vuelve a /callback con
 * un código, y el backend lo cambia por un id_token directamente con el proveedor.
 *
 * Validación del id_token: como llega por TLS directo desde el endpoint de tokens del
 * proveedor (autenticado con el client_secret), la especificación OIDC (Core 3.1.3.7)
 * permite usar esa conexión en lugar de verificar la firma. Sí se validan emisor,
 * destinatario, vencimiento y nonce.
 */

export interface SsoClaims {
  /** Identificador estable del usuario en el proveedor. */
  subject: string;
  email: string;
  emailVerified: boolean;
  name: string;
}

export interface SsoProvider {
  name: string;
  authorizationUrl(input: {
    state: string;
    nonce: string;
    codeChallenge: string;
    redirectUri: string;
  }): string;
  /** Cambia el código por la identidad validada. Lanza `SsoError` si algo no cuadra. */
  exchange(input: {
    code: string;
    codeVerifier: string;
    redirectUri: string;
    nonce: string;
  }): Promise<SsoClaims>;
}

export class SsoError extends Error {}

export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
}

const GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN = "https://oauth2.googleapis.com/token";
const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];

function base64UrlDecode(part: string): string {
  const b64 = part.replaceAll("-", "+").replaceAll("_", "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  const bin = atob(padded);
  return new TextDecoder().decode(Uint8Array.from(bin, (ch) => ch.charCodeAt(0)));
}

/** Lee el payload de un JWT sin verificar la firma (ver nota al inicio del archivo). */
export function decodeJwtPayload(jwt: string): Record<string, unknown> {
  const parts = jwt.split(".");
  if (parts.length !== 3) throw new SsoError("id_token con formato inválido");
  try {
    return JSON.parse(base64UrlDecode(parts[1]));
  } catch {
    throw new SsoError("id_token con formato inválido");
  }
}

export function googleProvider(config: GoogleConfig, fetchFn: typeof fetch = fetch): SsoProvider {
  return {
    name: "google",

    authorizationUrl({ state, nonce, codeChallenge, redirectUri }) {
      const url = new URL(GOOGLE_AUTH);
      url.search = new URLSearchParams({
        client_id: config.clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: "openid email profile",
        state,
        nonce,
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
        prompt: "select_account",
      }).toString();
      return url.toString();
    },

    async exchange({ code, codeVerifier, redirectUri, nonce }) {
      const res = await fetchFn(GOOGLE_TOKEN, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: config.clientId,
          client_secret: config.clientSecret,
          redirect_uri: redirectUri,
          grant_type: "authorization_code",
          code_verifier: codeVerifier,
        }),
      });
      if (!res.ok) throw new SsoError(`Google rechazó el código (${res.status})`);
      const body = await res.json() as { id_token?: string };
      if (!body.id_token) throw new SsoError("Google no entregó id_token");

      const c = decodeJwtPayload(body.id_token);
      if (!GOOGLE_ISSUERS.includes(String(c.iss))) throw new SsoError("Emisor inválido");
      const aud = Array.isArray(c.aud) ? c.aud : [c.aud];
      if (!aud.includes(config.clientId)) throw new SsoError("El token no es para esta app");
      if (typeof c.exp !== "number" || c.exp * 1000 < Date.now()) {
        throw new SsoError("Token vencido");
      }
      if (c.nonce !== nonce) throw new SsoError("Nonce inválido");
      if (typeof c.sub !== "string" || !c.sub) throw new SsoError("Token sin sujeto");
      if (typeof c.email !== "string" || !c.email) throw new SsoError("Token sin correo");

      return {
        subject: c.sub,
        email: c.email.toLowerCase(),
        emailVerified: c.email_verified === true || c.email_verified === "true",
        name: typeof c.name === "string" && c.name.trim() ? c.name.trim() : c.email.split("@")[0],
      };
    },
  };
}

/** Desafío PKCE S256 a partir del verificador. */
export async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  let bin = "";
  for (const b of new Uint8Array(digest)) bin += String.fromCharCode(b);
  return btoa(bin).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}
