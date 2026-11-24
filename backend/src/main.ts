import { createApp } from "./app.ts";
import { loadConfig } from "./config.ts";
import { createSql } from "./db/client.ts";
import { createFakeEngine } from "./engine/fake.ts";
import { createEngineFromEnv } from "./engine/engine.ts";
import { loadLlmConfig, providerLabel } from "./engine/llm.ts";
import type { Engine } from "./engine/types.ts";
import { googleProvider, type SsoProvider } from "./auth/sso.ts";
import { withStatic } from "./http/static.ts";

const config = loadConfig();
const sql = createSql(config.databaseUrl, config.dbSocketDir);

// Con las variables LLM_* usa la IA real; sin ellas (o con USE_FAKE_ENGINE=1), el motor falso.
function pickEngine(): Engine {
  if (Deno.env.get("USE_FAKE_ENGINE") === "1") return createFakeEngine();
  try {
    const llm = loadLlmConfig();
    console.log(`Motor: IA real (${providerLabel(llm)}, modelo ${llm.model})`);
    return createEngineFromEnv(llm);
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
  production: config.env === "production",
  sso,
  appUrl: config.appUrl,
  engine: pickEngine(),
});

// En la nube un solo servicio entrega la página y la API (/api/...), sin CORS ni proxy.
const handler = config.staticDir ? withStatic(app.fetch, config.staticDir) : app.fetch;
if (config.staticDir) console.log(`Sirviendo el frontend desde ${config.staticDir}`);
Deno.serve({ port: config.port, hostname: "0.0.0.0" }, handler);
