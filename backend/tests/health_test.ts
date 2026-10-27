import assert from "node:assert/strict";
import { buildApp } from "./helpers/app.ts";

Deno.test("GET /api/health responde ok", async () => {
  const app = buildApp();
  const res = await app.request("/api/health");
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { status: "ok" });
});

Deno.test("GET /api/health/db responde 503 si la base no está disponible", async () => {
  const app = buildApp({ pingDb: () => Promise.reject(new Error("down")) });
  const res = await app.request("/api/health/db");
  assert.equal(res.status, 503);
});

Deno.test("una ruta inexistente usa el formato de error común", async () => {
  const app = buildApp();
  const res = await app.request("/api/no-existe");
  assert.equal(res.status, 404);
  const body = await res.json();
  assert.equal(body.error.code, "NOT_FOUND");
});
