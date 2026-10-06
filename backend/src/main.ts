import { createApp } from "./app.ts";
import { loadConfig } from "./config.ts";
import { createSql } from "./db/client.ts";

const config = loadConfig();
const sql = createSql(config.databaseUrl);

const app = createApp({
  pingDb: async () => {
    await sql`SELECT 1`;
  },
});

Deno.serve({ port: config.port, hostname: "0.0.0.0" }, app.fetch);
