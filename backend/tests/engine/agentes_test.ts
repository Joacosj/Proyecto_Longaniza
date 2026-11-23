import assert from "node:assert/strict";
import { AGENTS, STAGE_AGENT } from "../../src/engine/agents.ts";
import type { JsonCompleter } from "../../src/engine/definition.ts";
import { ejemplo } from "../../src/engine/ejemplo.ts";
import {
  auditSemantics,
  citedIds,
  knownRefs,
  reviewDocuments,
} from "../../src/engine/ia_revision.ts";
import { stageSystemPrompt } from "../../src/engine/prompts/stages.ts";
import { designScreen, sketchScreen, unsafeHtmlReason } from "../../src/engine/visual.ts";

function fakeAi(responses: unknown[]) {
  const errors: string[] = [];
  const systems: string[] = [];
  const complete: JsonCompleter = (opts) => {
    systems.push(opts.system);
    for (let attempt = 0; attempt < 3; attempt++) {
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
  return { complete, errors, systems };
}

Deno.test("registro: nueve agentes con skills y tools, y un agente por etapa", () => {
  assert.equal(AGENTS.length, 9);
  assert.equal(new Set(AGENTS.map((a) => a.id)).size, 9);
  for (const a of AGENTS) {
    assert.ok(a.skills.length > 0 && a.tools.length > 0, `${a.id} sin skills o tools`);
  }
  for (const id of Object.values(STAGE_AGENT)) assert.ok(AGENTS.some((a) => a.id === id));
});

Deno.test("el Diseñador de interfaz recibe la skill de patrones de interfaz", () => {
  assert.match(stageSystemPrompt("frontend"), /Skill: patrones de interfaz web/);
  assert.doesNotMatch(stageSystemPrompt("database"), /Skill: patrones de interfaz web/);
});

Deno.test("verificador de referencias: reconoce ids del proyecto y los citados", () => {
  const known = knownRefs(ejemplo());
  assert.ok(known.has("REQ-1") && known.has("EP-1") && known.has("SCR-1") && known.has("rooms"));
  assert.deepEqual(citedIds("RULE-2 no se cumple en EP-3 ni en SCR-10"), [
    "RULE-2",
    "EP-3",
    "SCR-10",
  ]);
});

Deno.test("auditor: acepta hallazgos con ids reales y rechaza los que inventan ids", async () => {
  const ai = fakeAi([
    { findings: [{ stages: ["backend"], description: "RULE-99 no se aplica en EP-1" }] },
    { findings: [{ stages: ["backend"], description: "RULE-2 no se aplica en EP-2" }] },
  ]);
  const out = await auditSemantics(ai.complete, ejemplo());
  assert.match(ai.errors[0], /ids que no existen.*RULE-99/);
  assert.equal(out.length, 1);
  assert.equal(out[0].severity, "warning");
  assert.match(out[0].description, /^\[Auditor\] RULE-2/);
});

Deno.test("revisor externo: lee los documentos y devuelve preguntas por etapa", async () => {
  const ai = fakeAi([{
    findings: [{
      stage: "backend",
      question: "¿Qué devuelve EP-2 si la sala está inactiva?",
      rationale: "Falta el código de error.",
    }],
  }]);
  const out = await reviewDocuments(ai.complete, ejemplo());
  assert.deepEqual(out, [{
    stage: "backend",
    question: "¿Qué devuelve EP-2 si la sala está inactiva?",
    rationale: "Falta el código de error.",
  }]);
});

Deno.test("validador de HTML seguro: rechaza scripts, eventos y recursos externos", () => {
  assert.equal(unsafeHtmlReason("<html><body><div>ok</div></body></html>"), null);
  assert.match(unsafeHtmlReason("<html><script>alert(1)</script></html>")!, /script/);
  assert.match(unsafeHtmlReason('<div onclick="x()">a</div>')!, /eventos/);
  assert.match(unsafeHtmlReason('<div><img src="https://evil.com/x.png"></div>')!, /URLs externas/);
  assert.match(unsafeHtmlReason("<div><iframe></iframe></div>")!, /iframes/);
  assert.match(unsafeHtmlReason("<div>" + "x".repeat(41_000) + "</div>")!, /supera/);
});

Deno.test("diseñador visual: usa sus skills y pide corregir un HTML inseguro", async () => {
  const ai = fakeAi([
    { html: "<html><body><script>x</script></body></html>" },
    { html: "<!doctype html><html><body><div>Salas</div></body></html>" },
  ]);
  const out = await designScreen(ai.complete, { context: ejemplo(), screenId: "SCR-1" });
  assert.match(ai.systems[0], /Skill: sistema de diseño/);
  assert.match(ai.systems[0], /Skill: patrones de interfaz web/);
  assert.match(ai.errors[0], /contiene <script>/);
  assert.match(out.html, /Salas/);
});

Deno.test("vista previa sin IA: segura y con los bloques de la pantalla", () => {
  const fe = ejemplo().stages.frontend!;
  const html = sketchScreen(fe, fe.screens[0].id);
  assert.equal(unsafeHtmlReason(html), null);
  assert.ok(html.includes(fe.screens[0].layout[0].label.replace(/&/g, "&amp;")));
});
