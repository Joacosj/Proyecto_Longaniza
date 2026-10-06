/** Configuración leída desde variables de entorno. Nunca escribir secretos en el código. */
export interface Config {
  port: number;
  databaseUrl: string;
  env: "development" | "test" | "production";
}

export function loadConfig(): Config {
  const env = (Deno.env.get("APP_ENV") ?? "development") as Config["env"];
  return {
    port: Number(Deno.env.get("PORT") ?? 8000),
    databaseUrl: Deno.env.get("DATABASE_URL") ??
      "postgres://ideator:ideator@localhost:5432/ideator",
    env,
  };
}
