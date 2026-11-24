import assert from "node:assert/strict";
import { converseDefinition, type JsonCompleter, normalize } from "../../src/engine/definition.ts";
import { ejemplo } from "../../src/engine/ejemplo.ts";
import { createEngine } from "../../src/engine/engine.ts";
import type { ProjectContext } from "../../src/engine/types.ts";

/**
 * IA simulada: devuelve las respuestas en orden. Igual que completeJson, si una respuesta no
 * pasa la validación prueba con la siguiente (la "corrección") y registra el error.
 */
function fakeAi(responses: unknown[]) {
  const calls: { system: string; messages: { role: string; content: string }[] }[] = [];
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

function contexto(): ProjectContext {
  const c = ejemplo();
  return { ...c, stages: {}, answeredQuestions: [], openQuestions: [] };
}

const pregunta = (text: string, isBlocking: boolean) => ({
  text,
  rationale: "Cambia el modelo de datos",
  affects: isBlocking ? ["database"] : [],
  isBlocking,
});

const borrador = () => ejemplo().stages.definition!;

Deno.test("primer turno: devuelve la respuesta y las preguntas, sin borrador", async () => {
  const ai = fakeAi([{
    reply: "Entiendo que quieren reservar salas.",
    newQuestions: [pregunta("¿Cómo inician sesión?", true), pregunta("¿Qué color?", false)],
    artifactDraft: null,
  }]);
  const turn = await converseDefinition(ai.complete, {
    context: contexto(),
    history: [],
    userMessage: "Queremos una app para reservar salas.",
  });
  assert.equal(turn.reply, "Entiendo que quieren reservar salas.");
  assert.equal(turn.newQuestions.length, 2);
  assert.equal(turn.artifactDraft, undefined);
});

Deno.test("el contexto enviado incluye idea, respuestas, preguntas abiertas e historial", async () => {
  const ctx = contexto();
  ctx.answeredQuestions = [{ stage: "definition", text: "¿Roles?", answer: "Estudiante y admin" }];
  ctx.openQuestions = [{ stage: "definition", text: "¿Pagos?", isBlocking: true }];
  const ai = fakeAi([{ reply: "ok", newQuestions: [], artifactDraft: null }]);
  await converseDefinition(ai.complete, {
    context: ctx,
    history: [{ role: "user", content: "mensaje anterior" }],
    userMessage: "nuevo mensaje",
  });
  const { system, messages } = ai.calls[0];
  assert.match(system, /preguntas bloqueantes/i);
  assert.match(messages[0].content, /reserven salas de estudio/);
  assert.match(messages[0].content, /R: Estudiante y admin/);
  assert.match(messages[0].content, /\[BLOQUEANTE\] ¿Pagos\?/);
  assert.equal(messages.at(-2)!.content, "mensaje anterior");
  assert.equal(messages.at(-1)!.content, "nuevo mensaje");
});

Deno.test("descarta preguntas ya abiertas o respondidas, aunque cambien tildes o mayúsculas", async () => {
  const ctx = contexto();
  ctx.answeredQuestions = [{ stage: "definition", text: "¿Cómo inician sesión?", answer: "SSO" }];
  ctx.openQuestions = [{ stage: "definition", text: "¿Hay pagos?", isBlocking: false }];
  const ai = fakeAi([{
    reply: "ok",
    newQuestions: [
      pregunta("¿como inician sesion?", true),
      pregunta("¿HAY PAGOS?", false),
      pregunta("¿Cuántas salas hay?", false),
      pregunta("¿Cuántas salas hay?", false),
    ],
    artifactDraft: null,
  }]);
  const turn = await converseDefinition(ai.complete, {
    context: ctx,
    history: [],
    userMessage: "x",
  });
  assert.deepEqual(turn.newQuestions.map((q) => q.text), ["¿Cuántas salas hay?"]);
});

Deno.test("como máximo 4 preguntas por turno, bloqueantes primero", async () => {
  const ai = fakeAi([{
    reply: "ok",
    newQuestions: [
      pregunta("A", false),
      pregunta("B", false),
      pregunta("C", true),
      pregunta("D", false),
      pregunta("E", true),
      pregunta("F", false),
    ],
    artifactDraft: null,
  }]);
  const turn = await converseDefinition(ai.complete, {
    context: contexto(),
    history: [],
    userMessage: "x",
  });
  assert.deepEqual(turn.newQuestions.map((q) => q.text), ["C", "E", "A", "B"]);
});

Deno.test("con preguntas abiertas, la lista no crece más allá de 4 (al menos una nueva)", async () => {
  const nuevas = ["N1", "N2", "N3"].map((t) => pregunta(t, true));
  const ctx = contexto();
  ctx.openQuestions = ["A1", "A2", "A3"].map((text) => ({
    stage: "definition" as const,
    text,
    isBlocking: true,
  }));
  let ai = fakeAi([{ reply: "ok", newQuestions: nuevas, artifactDraft: null }]);
  let turn = await converseDefinition(ai.complete, { context: ctx, history: [], userMessage: "x" });
  assert.deepEqual(turn.newQuestions.map((q) => q.text), ["N1"]);

  ctx.openQuestions.push(
    ...["A4", "A5"].map((text) => ({ stage: "definition" as const, text, isBlocking: true })),
  );
  ai = fakeAi([{ reply: "ok", newQuestions: nuevas, artifactDraft: null }]);
  turn = await converseDefinition(ai.complete, { context: ctx, history: [], userMessage: "x" });
  assert.equal(turn.newQuestions.length, 1);
});

Deno.test("entrega el borrador cuando no quedan bloqueantes", async () => {
  const ai = fakeAi([{ reply: "Listo.", newQuestions: [], artifactDraft: borrador() }]);
  const turn = await converseDefinition(ai.complete, {
    context: contexto(),
    history: [],
    userMessage: "x",
  });
  assert.deepEqual(turn.artifactDraft, borrador());
});

Deno.test("no entrega borrador si queda una bloqueante abierta de un turno anterior", async () => {
  const ctx = contexto();
  ctx.openQuestions = [{ stage: "definition", text: "¿Roles?", isBlocking: true }];
  const ai = fakeAi([{ reply: "Listo.", newQuestions: [], artifactDraft: borrador() }]);
  const turn = await converseDefinition(ai.complete, {
    context: ctx,
    history: [],
    userMessage: "x",
  });
  assert.equal(turn.artifactDraft, undefined);
});

Deno.test("no entrega borrador si la IA plantea una bloqueante nueva en el mismo turno", async () => {
  const ai = fakeAi([{
    reply: "Casi.",
    newQuestions: [pregunta("¿Hay pagos?", true)],
    artifactDraft: borrador(),
  }]);
  const turn = await converseDefinition(ai.complete, {
    context: contexto(),
    history: [],
    userMessage: "x",
  });
  assert.equal(turn.artifactDraft, undefined);
  assert.equal(turn.newQuestions.length, 1);
});

Deno.test("una pregunta no bloqueante no impide el borrador", async () => {
  const ai = fakeAi([{
    reply: "Listo.",
    newQuestions: [pregunta("¿Color de la app?", false)],
    artifactDraft: borrador(),
  }]);
  const turn = await converseDefinition(ai.complete, {
    context: contexto(),
    history: [],
    userMessage: "x",
  });
  assert.ok(turn.artifactDraft);
});

Deno.test("un borrador con contradicciones se rechaza y se pide corregir", async () => {
  const roto = borrador();
  roto.requirements[0].featureId = "FEAT-9";
  const ai = fakeAi([
    { reply: "Listo.", newQuestions: [], artifactDraft: roto },
    { reply: "Corregido.", newQuestions: [], artifactDraft: borrador() },
  ]);
  const turn = await converseDefinition(ai.complete, {
    context: contexto(),
    history: [],
    userMessage: "x",
  });
  assert.match(ai.errors[0], /REQ-1 pertenece a FEAT-9/);
  assert.equal(turn.reply, "Corregido.");
  assert.ok(turn.artifactDraft);
});

Deno.test("un borrador con formato incorrecto indica la ruta exacta del error", async () => {
  const roto = borrador() as unknown as Record<string, unknown>;
  (roto.userTypes as { id: string }[])[0].id = "ROL1";
  const ai = fakeAi([
    { reply: "x", newQuestions: [], artifactDraft: roto },
    { reply: "x", newQuestions: [], artifactDraft: borrador() },
  ]);
  await converseDefinition(ai.complete, { context: contexto(), history: [], userMessage: "x" });
  assert.match(
    ai.errors[0],
    /artifactDraft\.userTypes\[0\]\.id debe tener el formato ROLE-<número>/,
  );
});

Deno.test("una pregunta bloqueante debe indicar qué etapas afecta", async () => {
  const ai = fakeAi([
    {
      reply: "x",
      newQuestions: [{ text: "¿Roles?", rationale: "r", affects: [], isBlocking: true }],
    },
    { reply: "x", newQuestions: [pregunta("¿Roles?", true)] },
  ]);
  await converseDefinition(ai.complete, { context: contexto(), history: [], userMessage: "x" });
  assert.match(ai.errors[0], /bloqueante pero affects está vacío/);
});

Deno.test("normalize ignora mayúsculas, tildes y signos", () => {
  assert.equal(normalize("¿Cómo INICIAN sesión?"), normalize("como inician sesion"));
});

Deno.test("el motor real usa la conversación en definición y orienta en las demás etapas", async () => {
  const ai = fakeAi([{ reply: "Hola", newQuestions: [], artifactDraft: null }]);
  const engine = createEngine(ai.complete);
  const def = await engine.converse({
    context: contexto(),
    stage: "definition",
    history: [],
    userMessage: "x",
  });
  assert.equal(def.reply, "Hola");
  const db = await engine.converse({
    context: contexto(),
    stage: "database",
    history: [],
    userMessage: "x",
  });
  assert.match(db.reply, /Generar con IA/);
  assert.equal(ai.calls.length, 1);
});

Deno.test("generar la definición incluye lo conversado en el chat", async () => {
  const ai = fakeAi([{
    reply: "Listo",
    newQuestions: [],
    artifactDraft: ejemplo().stages.definition,
  }]);
  const engine = createEngine(ai.complete);
  await engine.generate({
    context: contexto(),
    stage: "definition",
    history: [
      { role: "user", content: "Aclaración: los préstamos duran máximo 3 días hábiles." },
      { role: "assistant", content: "Anotado." },
    ],
  });
  const enviados = ai.calls[0].messages.map((m) => m.content).join("\n");
  assert.match(enviados, /máximo 3 días hábiles/);
  assert.match(ai.calls[0].messages.at(-1)!.content, /conversación/);
});
