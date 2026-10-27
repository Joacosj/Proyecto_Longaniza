/**
 * Conversación de prueba con la etapa 1 de Ideator, usando la IA real (Foundry).
 * Uso (desde backend/): deno task conversar
 *
 * Comandos durante la conversación:
 *   <texto>            mensaje libre para la IA
 *   r <n> <respuesta>  responde la pregunta abierta número n
 *   p <n>              pospone la pregunta n (solo si no es bloqueante)
 *   salir              termina
 */
import { checkConsistency } from "../src/engine/consistency.ts";
import { createEngineFromEnv } from "../src/engine/engine.ts";
import { LlmError } from "../src/engine/llm.ts";
import type { DefinitionArtifact } from "../src/contracts/artifacts.ts";
import type { ChatMessage, ProjectContext } from "../src/engine/types.ts";

const BORRADOR = "definicion-borrador.json";
const engine = createEngineFromEnv();

console.log("Ideator · etapa 1: definición del producto\n");
const projectName = prompt("Nombre del proyecto:")?.trim() || "Proyecto de prueba";
const initialIdea = prompt("Describe la idea en una o dos frases:")?.trim() ?? "";
if (!initialIdea) Deno.exit(0);

const ctx: ProjectContext = {
  projectName,
  initialIdea,
  stages: {},
  answeredQuestions: [],
  openQuestions: [],
};
const history: ChatMessage[] = [];

await turn(`Esta es nuestra idea: ${initialIdea}`);

while (true) {
  const input = prompt("\n>")?.trim();
  if (!input) continue;
  if (input === "salir") break;

  const answer = input.match(/^r\s+(\d+)\s+(.+)$/s);
  const postpone = input.match(/^p\s+(\d+)$/);
  if (answer || postpone) {
    const n = Number((answer ?? postpone)![1]) - 1;
    const q = ctx.openQuestions[n];
    if (!q) {
      console.log("No existe esa pregunta.");
      continue;
    }
    if (postpone) {
      if (q.isBlocking) {
        console.log("Es bloqueante: no se puede posponer.");
        continue;
      }
      ctx.openQuestions.splice(n, 1);
      console.log("Pregunta pospuesta.");
      continue;
    }
    ctx.openQuestions.splice(n, 1);
    ctx.answeredQuestions.push({ stage: "definition", text: q.text, answer: answer![2] });
    await turn(`Respondo: "${q.text}" → ${answer![2]}`);
  } else {
    await turn(input);
  }
}

async function turn(message: string) {
  console.log("\n(pensando…)");
  try {
    const r = await engine.converse({
      context: ctx,
      stage: "definition",
      history,
      userMessage: message,
    });
    history.push({ role: "user", content: message }, { role: "assistant", content: r.reply });
    for (const q of r.newQuestions) {
      ctx.openQuestions.push({ stage: "definition", text: q.text, isBlocking: q.isBlocking });
    }
    console.log(`\nIdeator: ${r.reply}`);

    if (ctx.openQuestions.length) {
      console.log("\nPreguntas abiertas:");
      ctx.openQuestions.forEach((q, i) =>
        console.log(`  ${i + 1}. ${q.isBlocking ? "[BLOQUEANTE] " : ""}${q.text}`)
      );
      const why = r.newQuestions.filter((q) => q.isBlocking);
      if (why.length) {
        console.log("\nPor qué son bloqueantes:");
        why.forEach((q) => {
          const n = ctx.openQuestions.findIndex((o) => o.text === q.text) + 1;
          console.log(`  ${n}. ${q.rationale} (afecta: ${q.affects.join(", ")})`);
        });
      }
      console.log("\nResponde con: r <número> <respuesta>");
    }

    if (r.artifactDraft) {
      const d = r.artifactDraft as DefinitionArtifact;
      ctx.stages.definition = d;
      const issues = checkConsistency(ctx);
      await Deno.writeTextFile(BORRADOR, JSON.stringify(d, null, 2));
      console.log(
        `\nBorrador de la definición: ${d.userTypes.length} roles, ${d.mvp.included.length} ` +
          `funcionalidades, ${d.requirements.length} requisitos, ${d.businessRules.length} reglas, ` +
          `${d.edgeCases.length} casos borde. Guardado en backend/${BORRADOR}.`,
      );
      issues.forEach((i) => console.log(`  [${i.severity}] ${i.description}`));
    }
  } catch (e) {
    console.log(e instanceof LlmError ? `Error (${e.kind}): ${e.message}` : e);
  }
}
