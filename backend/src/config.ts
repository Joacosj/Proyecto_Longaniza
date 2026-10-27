/** Configuración leída desde variables de entorno. Nunca escribir secretos en el código. */
export interface Config {
  port: number;
  databaseUrl: string;
  env: "development" | "test" | "production";
  /** Clave para firmar (HMAC) los tokens de sesión antes de guardarlos en la base. */
  sessionSecret: string;
}

export function loadConfig(): Config {
  const env = (Deno.env.get("APP_ENV") ?? "development") as Config["env"];
  const sessionSecret = Deno.env.get("SESSION_SECRET") ?? "";
  if (env === "production" && sessionSecret.length < 32) {
    throw new Error("SESSION_SECRET debe tener al menos 32 caracteres en producción");
  }
  return {
    port: Number(Deno.env.get("PORT") ?? 8000),
    databaseUrl: Deno.env.get("DATABASE_URL") ??
      "postgres://ideator:ideator@localhost:5432/ideator",
    env,
    sessionSecret: sessionSecret || "dev-only-secret-change-me",
  };
}
