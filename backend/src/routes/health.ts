import { Hono } from "hono";

export interface HealthDeps {
  /** Lanza un error si la base de datos no responde. */
  pingDb: () => Promise<void>;
}

export function healthRoutes(deps: HealthDeps) {
  const r = new Hono();

  r.get("/", (c) => c.json({ status: "ok" }));

  r.get("/db", async (c) => {
    try {
      await deps.pingDb();
      return c.json({ status: "ok" });
    } catch {
      return c.json({ status: "unavailable" }, 503);
    }
  });

  return r;
}
