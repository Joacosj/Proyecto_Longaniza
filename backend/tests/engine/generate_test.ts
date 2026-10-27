import assert from "node:assert/strict";
import type { JsonCompleter } from "../../src/engine/definition.ts";
import { ejemplo } from "../../src/engine/ejemplo.ts";
import { createEngine } from "../../src/engine/engine.ts";
import { generateStage } from "../../src/engine/generate.ts";
import { ApiError } from "../../src/http/errors.ts";
import type { ProjectContext } from "../../src/engine/types.ts";

/** IA simulada: igual que completeJson, si una respuesta no valida prueba con la siguiente. */
function fakeAi(responses: unknown[]) {
  const calls: { system: string; messages: { content: string }[] }[] = [];
  const errors: string[] = [];
  const complete: JsonCompleter = (opts) => {
    calls.push({ system: opts.system, messages: opts.messages });
    for (let attempt = 0; attempt < 2; attempt++) {
      const next = responses.shift();
      if (next === undefined) break;
      try {
        return Promise.resolve(opts.validate(next));
      } catch (e) {
        errors.push((e as Error).message);
      }
    }
    return Promise.reject(new Error("respuesta inválida: " + errors.at(-1)));
  };
  return { complete, calls, errors };
}

/** El ejemplo, con solo las etapas anteriores a `stage`. */
function hasta(stage: "database" | "backend" | "frontend" | "architecture"): ProjectContext {
  const ctx = ejemplo();
  const order = ["definition", "database", "backend", "frontend", "architecture"];
  for (const s of order.slice(order.indexOf(stage))) {
    delete (ctx.stages as Record<string, unknown>)[s];
  }
  return ctx;
}

const respuesta = (stage: "database" | "backend" | "frontend" | "architecture") => ({
  artifact: ejemplo().stages[stage],
  questions: [],
});

for (const stage of ["database", "backend", "frontend", "architecture"] as const) {
  Deno.test(`genera la etapa ${stage} y la acepta si es coherente con las anteriores`, async () => {
    const ai = fakeAi([respuesta(stage)]);
    const out = await generateStage(ai.complete, { context: hasta(stage), stage });
    // Se compara como JSON, que es como se guarda: un campo opcional ausente o undefined es igual.
    assert.deepEqual(JSON.parse(JSON.stringify(out.artifact)), ejemplo().stages[stage]);
    assert.equal(ai.errors.length, 0);
  });
}

Deno.test("el contexto incluye las etapas anteriores, las decisiones y nada posterior", async () => {
  const ai = fakeAi([respuesta("backend")]);
  await generateStage(ai.complete, { context: hasta("backend"), stage: "backend" });
  const msg = ai.calls[0].messages[0].content;
  assert.match(msg, /## Etapa ya definida: definition/);
  assert.match(msg, /## Etapa ya definida: database/);
  assert.doesNotMatch(msg, /Etapa ya definida: frontend/);
  assert.match(msg, /cuenta institucional de Microsoft/);
  assert.match(ai.calls[0].system, /Etapa: backend y API REST/);
});

Deno.test("la etapa de arquitectura recibe el catálogo de las cinco arquitecturas", async () => {
  const ai = fakeAi([respuesta("architecture")]);
  await generateStage(ai.complete, { context: hasta("architecture"), stage: "architecture" });
  assert.match(ai.calls[0].messages[0].content, /edge-first/);
});

Deno.test("si la propuesta usa una tabla inexistente, pide corregir con el error exacto", async () => {
  const mala = respuesta("backend");
  (mala.artifact as { endpoints: { entities: string[] }[] }).endpoints[0].entities = ["salas"];
  const ai = fakeAi([structuredClone(mala), respuesta("backend")]);
  const out = await generateStage(ai.complete, { context: hasta("backend"), stage: "backend" });
  assert.match(ai.errors[0], /EP-1 .* entidad "salas"/);
  assert.ok(out.artifact);
});

Deno.test("una pantalla que llama a un endpoint inexistente se rechaza", async () => {
  const mala = structuredClone(respuesta("frontend"));
  (mala.artifact as { screens: { actions: { endpointId?: string }[] }[] }).screens[1].actions[0]
    .endpointId = "EP-42";
  const ai = fakeAi([mala, respuesta("frontend")]);
  await generateStage(ai.complete, { context: hasta("frontend"), stage: "frontend" });
  assert.match(ai.errors[0], /EP-42/);
});

Deno.test("una arquitectura con alternativas abiertas se rechaza", async () => {
  const mala = structuredClone(respuesta("architecture"));
  (mala.artifact as { stack: { backend: string } }).stack.backend = "Fastify o Express";
  const ai = fakeAi([mala, respuesta("architecture")]);
  await generateStage(ai.complete, { context: hasta("architecture"), stage: "architecture" });
  assert.match(ai.errors[0], /alternativas abiertas/);
});

Deno.test("el formato incorrecto indica la ruta exacta", async () => {
  const mala = structuredClone(respuesta("database"));
  (mala.artifact as { entities: { name: string }[] }).entities[0].name = "Usuarios";
  const ai = fakeAi([mala, respuesta("database")]);
  await generateStage(ai.complete, { context: hasta("database"), stage: "database" });
  assert.match(ai.errors[0], /artifact\.entities\[0\]\.name debe estar en snake_case/);
});

Deno.test("no genera si faltan etapas anteriores", async () => {
  const ctx = hasta("backend");
  delete ctx.stages.database;
  await assert.rejects(
    generateStage(fakeAi([]).complete, { context: ctx, stage: "backend" }),
    /faltan las etapas database/,
  );
});

Deno.test("las preguntas que plantee la IA se devuelven", async () => {
  const ai = fakeAi([{
    ...respuesta("database"),
    questions: [{
      text: "¿Se guardan fotos?",
      rationale: "r",
      affects: ["database"],
      isBlocking: true,
    }],
  }]);
  const out = await generateStage(ai.complete, { context: hasta("database"), stage: "database" });
  assert.equal(out.questions[0].text, "¿Se guardan fotos?");
});

Deno.test("generar la definición con bloqueantes pendientes responde 409 con las preguntas", async () => {
  const ai = fakeAi([{
    reply: "Falta algo",
    newQuestions: [{
      text: "¿Hay pagos?",
      rationale: "r",
      affects: ["database"],
      isBlocking: true,
    }],
    artifactDraft: null,
  }]);
  const engine = createEngine(ai.complete);
  await assert.rejects(
    engine.generate({ context: hasta("database"), stage: "definition" }),
    (e) => e instanceof ApiError && e.status === 409,
  );
});

Deno.test("un error de la IA llega como mensaje claro", async () => {
  const { LlmError } = await import("../../src/engine/llm.ts");
  const engine = createEngine(() => Promise.reject(new LlmError("timeout", "lento")));
  await assert.rejects(
    engine.generate({ context: hasta("database"), stage: "database" }),
    (e) => e instanceof ApiError && /tardó demasiado/.test(e.message),
  );
});
