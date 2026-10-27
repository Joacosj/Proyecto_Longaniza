import { createApp } from "./app.ts";
import { loadConfig } from "./config.ts";
import { createSql } from "./db/client.ts";
import { createFakeEngine } from "./engine/fake.ts";

const config = loadConfig();
const sql = createSql(config.databaseUrl);

const app = createApp({
  pingDb: async () => {
    await sql`SELECT 1`;
  },
  sql,
  sessionSecret: config.sessionSecret,
  secureCookies: config.env === "production",
  // Reemplazar por el motor real de la mitad B cuando esté listo.
  engine: createFakeEngine(),
});

Deno.serve({ port: config.port, hostname: "0.0.0.0" }, app.fetch);
