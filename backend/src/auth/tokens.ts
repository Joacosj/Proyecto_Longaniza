/**
 * Tokens opacos para sesiones (y luego invitaciones). El valor solo viaja al cliente;
 * en la base se guarda HMAC-SHA256(secret, token), así una filtración de la tabla no
 * permite usar las sesiones.
 */

function toHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

/** 32 bytes aleatorios en base64url (43 caracteres). */
export function generateToken(): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

const keyCache = new Map<string, Promise<CryptoKey>>();

function getKey(secret: string): Promise<CryptoKey> {
  let key = keyCache.get(secret);
  if (!key) {
    key = crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    keyCache.set(secret, key);
  }
  return key;
}

export async function hashToken(token: string, secret: string): Promise<string> {
  const sig = await crypto.subtle.sign(
    "HMAC",
    await getKey(secret),
    new TextEncoder().encode(token),
  );
  return toHex(sig);
}

/**
 * Firma un valor (JSON) para guardarlo en una cookie que el cliente no puede alterar.
 * Formato: base64url(json).hmac
 */
export async function signValue(value: unknown, secret: string): Promise<string> {
  const payload = toBase64Url(new TextEncoder().encode(JSON.stringify(value)));
  return `${payload}.${await hashToken(payload, secret)}`;
}

/** Verifica y devuelve el valor firmado, o undefined si fue alterado. */
export async function verifySignedValue<T>(signed: string, secret: string): Promise<T | undefined> {
  const dot = signed.lastIndexOf(".");
  if (dot <= 0) return undefined;
  const payload = signed.slice(0, dot);
  const sig = signed.slice(dot + 1);
  const expected = await hashToken(payload, secret);
  if (sig.length !== expected.length) return undefined;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
  if (diff !== 0) return undefined;
  try {
    const b64 = payload.replaceAll("-", "+").replaceAll("_", "/");
    const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
  } catch {
    return undefined;
  }
}
