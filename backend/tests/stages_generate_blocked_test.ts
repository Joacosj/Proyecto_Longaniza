import assert from "node:assert/strict";
import { createFakeEngine } from "../src/engine/fake.ts";
import type { Engine } from "../src/engine/types.ts";
import { ApiError } from "../src/http/errors.ts";
import { buildApp, TestClient } from "./helpers/app.ts";
import { createTestDb } from "./helpers/db.ts";

Deno.test("generar la definición sin decisiones guarda las preguntas de la IA", async () => {
  const db = await createTestDb();
  const engine: Engine = {
    ...createFakeEngine(),
    generate: () => {
      throw new ApiError("CONFLICT", "Faltan decisiones", {
        questions: [
          {
            text: "¿Quién crea reportes?",
            rationale: "Roles",
            affects: ["database"],
            isBlocking: true,
          },
          { text: "¿Hay categorías?", rationale: "Detalle", affects: [], isBlocking: false },
        ],
      });
    },
  };
  const app = buildApp({ sql: db.sql, engine });
  const ana = new TestClient(app);
  try {
    await ana.register("ana@example.com", "Ana");
    const created = await ana.post("/api/projects", { name: "Barrio", initialIdea: "Reportes" });
    const projectId = (await created.json()).project.id as string;

    const res = await ana.post(`/api/projects/${projectId}/stages/definition/generate`);
    assert.equal(res.status, 409);
    const body = await res.json();
    assert.deepEqual(
      body.error.details.blockingQuestions.map((q: { text: string }) => q.text),
      ["¿Quién crea reportes?"],
    );

    const list = await (await ana.get(`/api/projects/${projectId}/questions?stage=definition`))
      .json();
    assert.equal(list.questions.length, 2);
  } finally {
    await db.close();
  }
});
