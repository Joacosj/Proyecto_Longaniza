import { Hono } from "hono";
import { type AuthEnv, requireUser } from "../auth/session.ts";
import type { StageDeps } from "./stages.ts";

/** Catálogo de las cinco arquitecturas base. Lo entrega el motor. */
export function architectureRoutes(deps: StageDeps) {
  const r = new Hono<AuthEnv>();
  r.get("/", requireUser(deps), (c) => c.json({ architectures: deps.engine.listArchitectures() }));
  return r;
}
