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
