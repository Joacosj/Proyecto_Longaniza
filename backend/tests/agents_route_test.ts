import assert from "node:assert/strict";
import { createFakeEngine } from "../src/engine/fake.ts";
import type { Engine } from "../src/engine/types.ts";
import { buildApp, joinProject, TestClient } from "./helpers/app.ts";
import { createTestDb } from "./helpers/db.ts";

Deno.test("agentes: estado, auditor, revisor externo y vistas previas", async (t) => {
  const db = await createTestDb();
  const engine: Engine = {
    ...createFakeEngine(),
    auditSemantics: () =>
      Promise.resolve([{
        stages: ["backend"],
        description: "[Auditor] RULE-2 sin aplicar en EP-2",
        severity: "warning",
      }]),
    reviewDocuments: () =>
      Promise.resolve([{
        stage: "backend",
        question: "¿Qué responde EP-2 si la sala no existe?",
        rationale: "Falta el 404.",
      }]),
  };
  const app = buildApp({ sql: db.sql, engine });
  const ana = new TestClient(app);
  const carla = new TestClient(app);
  try {
    await ana.register("ana@example.com", "Ana");
    const carlaUser = await carla.register("carla@example.com", "Carla");
    const projectId =
      (await (await ana.post("/api/projects", { name: "Salas", initialIdea: "x" })).json()).project
        .id;
    await joinProject(ana, carla, carlaUser.email, projectId, "viewer");
    const base = `/api/projects/${projectId}`;
    const stage = async (k: string) => (await (await ana.get(`${base}/stages/${k}`)).json()).stage;
    for (const k of ["definition", "database", "backend", "frontend", "architecture"]) {
      await ana.post(`${base}/stages/${k}/generate`);
      await ana.post(`${base}/stages/${k}/approve`, { version: (await stage(k)).version });
    }

    await t.step("catálogo y estado: cada agente con su última acción", async () => {
      const cat = await (await ana.get("/api/agents")).json();
      assert.equal(cat.agents.length, 9);
      const res = await (await carla.get(`${base}/agents`)).json();
      const api = res.agents.find((a: { id: string }) => a.id === "disenador-api");
      assert.equal(api.lastAction.action, "stage.generated");
      assert.deepEqual(api.working, []);
    });

    await t.step(
      "auditor: sus hallazgos quedan abiertos aunque se revise la consistencia",
      async () => {
        assert.equal((await carla.post(`${base}/semantic-audit`)).status, 403);
        const res = await (await ana.post(`${base}/semantic-audit`)).json();
        assert.equal(res.added, 1);
        await ana.post(`${base}/consistency-check`);
        const open = (await (await ana.get(`${base}/review`)).json()).inconsistencies;
        assert.ok(open.some((i: { source: string }) => i.source === "auditor"));
        const again = await (await ana.post(`${base}/semantic-audit`)).json();
        assert.equal(again.added, 0, "no duplica hallazgos abiertos");
      },
    );

    await t.step(
      "revisor externo: deja preguntas no bloqueantes en la etapa indicada",
      async () => {
        const res = await (await ana.post(`${base}/external-review`)).json();
        assert.equal(res.questions.length, 1);
        assert.equal(res.questions[0].stageKind, "backend");
        assert.equal(res.questions[0].isBlocking, false);
        assert.match(res.questions[0].rationale, /^Revisor externo:/);
      },
    );

    await t.step("diseñador visual: guarda la vista previa y la ve un lector", async () => {
      assert.equal((await ana.post(`${base}/screens/SCR-99/preview`)).status, 404);
      assert.equal((await ana.post(`${base}/screens/x;drop/preview`)).status, 400);
      const res = await ana.post(`${base}/screens/SCR-1/preview`);
      assert.equal(res.status, 200);
      const list = (await (await carla.get(`${base}/screen-previews`)).json()).previews;
      assert.equal(list.length, 1);
      assert.match(list[0].html, /<html>/);
    });
  } finally {
    await db.close();
  }
});

Deno.test("seguridad: cabeceras en la API y límite de intentos de acceso", async () => {
  const app = buildApp({ limits: { auth: 3, ai: 100 } });
  const res = await app.request("/api/health");
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  assert.equal(res.headers.get("x-frame-options"), "DENY");
  assert.match(res.headers.get("content-security-policy") ?? "", /frame-ancestors 'none'/);
  assert.equal(res.headers.get("cache-control"), "no-store");

  const login = () =>
    app.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Forwarded-For": "203.0.113.7" },
      body: JSON.stringify({ email: "", password: "" }),
    });
  for (let i = 0; i < 3; i++) assert.notEqual((await login()).status, 429);
  const blocked = await login();
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers.get("retry-after")) > 0);
});

Deno.test("seguridad: rechaza cuerpos demasiado grandes", async () => {
  const app = buildApp();
  const res = await app.request("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Content-Length": String(3 * 1024 * 1024) },
    body: "{}",
  });
  assert.equal(res.status, 413);
});
