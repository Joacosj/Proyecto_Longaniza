import assert from "node:assert/strict";
import { createFakeEngine } from "../../src/engine/fake.ts";
import { ejemplo } from "../../src/engine/ejemplo.ts";

Deno.test("el motor falso genera etapas coherentes y documentos reales", async () => {
  const engine = createFakeEngine();
  const ctx = { ...ejemplo(), stages: {} };
  for (const stage of ["definition", "database", "backend", "frontend", "architecture"] as const) {
    const { artifact } = await engine.generate({ context: ctx, stage });
    (ctx.stages as Record<string, unknown>)[stage] = artifact;
  }
  assert.deepEqual(engine.checkConsistency(ctx), []);
  const docs = engine.renderDocuments(ctx);
  assert.match(docs.productSpec, /^# Especificación de producto/);
  assert.match(docs.architecture, /^# Arquitectura/);
  assert.equal(engine.listArchitectures().length, 5);
});

Deno.test("el motor falso plantea una pregunta bloqueante en la etapa de definición", async () => {
  const { newQuestions } = await createFakeEngine().converse({
    context: ejemplo(),
    stage: "definition",
    history: [],
    userMessage: "hola",
  });
  assert.equal(newQuestions.length, 1);
  assert.equal(newQuestions[0].isBlocking, true);
});
