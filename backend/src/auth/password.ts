import bcrypt from "bcryptjs";

/** Costo de bcrypt. 10 es el estándar razonable; las pruebas lo bajan con BCRYPT_COST. */
function cost(): number {
  return Number(Deno.env.get("BCRYPT_COST") ?? 10);
}

/** bcrypt solo considera los primeros 72 bytes; las validaciones limitan el largo antes. */
export const MAX_PASSWORD_BYTES = 72;

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, cost());
}

export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/**
 * Hash de una contraseña que nadie conoce. Se compara contra él cuando el correo no existe,
 * para que el tiempo de respuesta no revele qué correos están registrados.
 */
let dummyHash: Promise<string> | undefined;
export function getDummyHash(): Promise<string> {
  dummyHash ??= hashPassword(crypto.randomUUID());
  return dummyHash;
}
