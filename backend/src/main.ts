import { createApp } from "./app.ts";
import { loadConfig } from "./config.ts";
import { createSql } from "./db/client.ts";
import { createFakeEngine } from "./engine/fake.ts";
import { createEngineFromEnv } from "./engine/engine.ts";
import type { Engine } from "./engine/types.ts";
import { googleProvider, type SsoProvider } from "./auth/sso.ts";

const config = loadConfig();
const sql = createSql(config.databaseUrl);

// Con las variables LLM_* usa la IA real; sin ellas (o con USE_FAKE_ENGINE=1), el motor falso.
function pickEngine(): Engine {
  if (Deno.env.get("USE_FAKE_ENGINE") === "1") return createFakeEngine();
  try {
    const engine = createEngineFromEnv();
    console.log("Motor: IA real (Microsoft Foundry)");
    return engine;
  } catch (e) {
    console.warn(`Motor: falso (${(e as Error).message})`);
    return createFakeEngine();
  }
}

const sso: Record<string, SsoProvider> = {};
if (config.google) sso.google = googleProvider(config.google);

const app = createApp({
  pingDb: async () => {
    await sql`SELECT 1`;
  },
  sql,
  sessionSecret: config.sessionSecret,
  secureCookies: config.env === "production",
  sso,
  appUrl: config.appUrl,
  engine: pickEngine(),
});

Deno.serve({ port: config.port, hostname: "0.0.0.0" }, app.fetch);
