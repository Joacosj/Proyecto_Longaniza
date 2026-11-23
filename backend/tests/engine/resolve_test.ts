import assert from "node:assert/strict";
import type { FrontendArtifact } from "../../src/contracts/artifacts.ts";
import { checkConsistency } from "../../src/engine/consistency.ts";
import type { JsonCompleter } from "../../src/engine/definition.ts";
import { ejemplo } from "../../src/engine/ejemplo.ts";
import { generateStage } from "../../src/engine/generate.ts";
import { describeChanges, resolveInconsistency, targetStage } from "../../src/engine/resolve.ts";
import type { ProjectContext } from "../../src/engine/types.ts";

/** IA simulada con los mismos 3 intentos que completeJson. */
function fakeAi(responses: unknown[]) {
  const errors: string[] = [];
  const prompts: string[] = [];
  const complete: JsonCompleter = (opts) => {
    prompts.push(opts.messages[0]?.content ?? "");
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
  return { complete, errors, prompts };
}

/** Quita la única acción que llama a un endpoint, para que quede sin pantalla. */
function sinUnEndpoint(): { fe: FrontendArtifact; endpointId: string } {
  const fe = structuredClone(ejemplo().stages.frontend!);
  const uses = new Map<string, number>();
  fe.screens.forEach((s) =>
    s.actions.forEach((a) =>
      a.endpointId && uses.set(a.endpointId, (uses.get(a.endpointId) ?? 0) + 1)
    )
  );
  const endpointId = [...uses].find(([, n]) => n === 1)![0];
  fe.screens.forEach((s) => s.actions = s.actions.filter((a) => a.endpointId !== endpointId));
  return { fe, endpointId };
}

function contextoCon(fe: FrontendArtifact): ProjectContext {
  const ctx = ejemplo();
  ctx.stages.frontend = fe;
  return ctx;
}

Deno.test("resolver: propone un cambio en la etapa más tardía y lo acepta si cierra la inconsistencia", async () => {
  const { fe, endpointId } = sinUnEndpoint();
  const ctx = contextoCon(fe);
  const inc = checkConsistency(ctx).find((i) => i.description.includes(endpointId))!;
  assert.ok(inc, "debe existir la advertencia del endpoint sin pantalla");
  assert.equal(targetStage(inc), "frontend");

  const ai = fakeAi([{
    action: "fix",
    summary: "Vuelve a llamar al endpoint",
    artifact: ejemplo().stages.frontend,
  }]);
  const out = await resolveInconsistency(ai.complete, { context: ctx, inconsistency: inc });
  assert.equal(out.kind, "fix");
  if (out.kind === "fix") assert.equal(out.stage, "frontend");
  assert.match(ai.prompts[0], /Etapa que puedes cambiar: frontend/);
});

Deno.test("resolver: rechaza una propuesta que no cierra la inconsistencia y pide corregir", async () => {
  const { fe, endpointId } = sinUnEndpoint();
  const ctx = contextoCon(fe);
  const inc = checkConsistency(ctx).find((i) => i.description.includes(endpointId))!;
  const ai = fakeAi([
    { action: "fix", summary: "nada", artifact: fe },
    { action: "fix", summary: "ahora sí", artifact: ejemplo().stages.frontend },
  ]);
  const out = await resolveInconsistency(ai.complete, { context: ctx, inconsistency: inc });
  assert.equal(out.kind, "fix");
  assert.match(ai.errors[0], /sigue presente/);
});

Deno.test("resolver: si hace falta cambiar una etapa anterior, devuelve manual con la explicación", async () => {
  const { fe, endpointId } = sinUnEndpoint();
  const ctx = contextoCon(fe);
  const inc = checkConsistency(ctx).find((i) => i.description.includes(endpointId))!;
  const ai = fakeAi([{ action: "manual", stage: "backend", explanation: "Falta un endpoint." }]);
  const out = await resolveInconsistency(ai.complete, { context: ctx, inconsistency: inc });
  assert.deepEqual(out, { kind: "manual", stage: "backend", explanation: "Falta un endpoint." });
});

Deno.test("describeChanges lista lo agregado, modificado y quitado por id", () => {
  const before = {
    screens: [{ id: "SCR-1", name: "A" }, { id: "SCR-2", name: "B" }],
    entryScreenId: "SCR-1",
  };
  const after = {
    screens: [{ id: "SCR-1", name: "A2" }, { id: "SCR-3", name: "C" }],
    entryScreenId: "SCR-1",
  };
  assert.deepEqual(describeChanges(before, after), [
    "Modifica SCR-1 en screens",
    "Agrega SCR-3 en screens",
    "Quita SCR-2 de screens",
  ]);
});

Deno.test("prevención: una advertencia arreglable en la etapa se devuelve a la IA antes de aceptarla", async () => {
  const { fe } = sinUnEndpoint();
  const ctx = ejemplo();
  delete ctx.stages.frontend;
  delete ctx.stages.architecture;
  const ai = fakeAi([
    { artifact: fe, questions: [] },
    { artifact: ejemplo().stages.frontend, questions: [] },
  ]);
  const out = await generateStage(ai.complete, { context: ctx, stage: "frontend" });
  assert.match(ai.errors[0], /advertencias que puedes resolver/);
  assert.equal(JSON.stringify(out.artifact), JSON.stringify(ejemplo().stages.frontend));
});

Deno.test("prevención: en el último intento se acepta con la advertencia, para no trabar", async () => {
  const { fe } = sinUnEndpoint();
  const ctx = ejemplo();
  delete ctx.stages.frontend;
  delete ctx.stages.architecture;
  const r = { artifact: fe, questions: [] };
  const ai = fakeAi([r, r, r]);
  const out = await generateStage(ai.complete, { context: ctx, stage: "frontend" });
  assert.equal(ai.errors.length, 2);
  assert.ok(out.artifact);
});
