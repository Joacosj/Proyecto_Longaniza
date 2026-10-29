/**
 * Conversación de prueba con la etapa 1 de Ideator, usando la IA real (Foundry).
 * Uso (desde backend/): deno task conversar
 *
 * Comandos durante la conversación:
 *   <texto>            mensaje libre para la IA
 *   r <n> <respuesta>  responde la pregunta abierta número n (se pueden poner varias en
 *                      una línea: "r 1 sí r 3 no")
 *   p <n>              pospone la pregunta n (solo si no es bloqueante)
 *   reintentar         vuelve a enviar el último mensaje si falló
 *   salir              termina (la conversación queda guardada y se puede retomar)
 */
import { checkConsistency } from "../src/engine/consistency.ts";
import { createEngineFromEnv } from "../src/engine/engine.ts";
import { LlmError } from "../src/engine/llm.ts";
import type { DefinitionArtifact } from "../src/contracts/artifacts.ts";
import type { ChatMessage, NewQuestion, ProjectContext } from "../src/engine/types.ts";

const BORRADOR = "definicion-borrador.json";
/** Se guarda tras cada paso para poder retomar si algo falla o se cierra la terminal. */
const SESION = "definicion-sesion.json";
const engine = createEngineFromEnv();

console.log("Ideator · etapa 1: definición del producto\n");

let ctx: ProjectContext;
let history: ChatMessage[] = [];
let pending: string | undefined;

const previous = await readSession();
if (
  previous &&
  prompt(`Hay una conversación guardada ("${previous.ctx.projectName}"). ¿Continuarla? (s/n)`)
      ?.trim().toLowerCase() === "s"
) {
  ({ ctx, history, pending } = previous);
  console.log(
    `Retomando: ${ctx.answeredQuestions.length} respuestas y ${ctx.openQuestions.length} preguntas abiertas.`,
  );
  printOpenQuestions();
} else {
  const projectName = prompt("Nombre del proyecto:")?.trim() || "Proyecto de prueba";
  const initialIdea = prompt("Describe la idea en una o dos frases:")?.trim() ?? "";
  if (!initialIdea) Deno.exit(0);
  ctx = { projectName, initialIdea, stages: {}, answeredQuestions: [], openQuestions: [] };
  pending = `Esta es nuestra idea: ${initialIdea}`;
}

// Si el último turno no llegó a responderse (por ejemplo, por un timeout), se reintenta.
if (pending) await turn(pending);

while (true) {
  const input = prompt("\n>")?.trim();
  if (!input) continue;
  if (input === "salir") break;
  if (input === "reintentar") {
    if (pending) await turn(pending);
    else console.log("No hay nada pendiente de enviar.");
    continue;
  }

  const postpone = input.match(/^p\s+(\d+)$/);
  if (postpone) {
    const n = Number(postpone[1]) - 1;
    const q = ctx.openQuestions[n];
    if (!q) console.log("No existe esa pregunta.");
    else if (q.isBlocking) console.log("Es bloqueante: no se puede posponer.");
    else {
      ctx.openQuestions.splice(n, 1);
      console.log("Pregunta pospuesta.");
    }
    continue;
  }

  const answers = parseAnswers(input);
  if (answers.length) {
    // Los números se refieren a la lista mostrada, así que se validan todos antes de quitar nada.
    const missing = answers.filter((a) => !ctx.openQuestions[a.n - 1]).map((a) => a.n);
    if (missing.length) {
      console.log(`No existe la pregunta ${missing.join(", ")}.`);
      continue;
    }
    // Se quitan de mayor a menor para no mover los números, pero se guardan en el orden mostrado.
    const answered: { text: string; answer: string }[] = [];
    for (const a of [...answers].sort((x, y) => y.n - x.n)) {
      const [q] = ctx.openQuestions.splice(a.n - 1, 1);
      answered.unshift({ text: q.text, answer: a.text });
    }
    answered.forEach((q) => ctx.answeredQuestions.push({ stage: "definition", ...q }));
    const lines = answered.map((q) => `- "${q.text}" → ${q.answer}`);
    await turn(`Respondo:\n${lines.join("\n")}`);
  } else {
    await turn(input);
  }
}

/** Lee una o varias respuestas en una línea: "r 1 texto r 3 otro texto". */
export function parseAnswers(input: string): { n: number; text: string }[] {
  if (!/^r\s+\d+\s+\S/.test(input)) return [];
  const out: { n: number; text: string }[] = [];
  const parts = input.split(/(?:^|\s+)r\s+(\d+)\s+/).slice(1);
  for (let i = 0; i < parts.length; i += 2) {
    const text = parts[i + 1]?.trim();
    if (text) out.push({ n: Number(parts[i]), text });
  }
  // Si un número se repite, vale la última respuesta.
  return [...new Map(out.map((a) => [a.n, a])).values()];
}

async function turn(message: string) {
  pending = message;
  await saveSession();
  console.log("\n(pensando…)");
  try {
    const r = await engine.converse({
      context: ctx,
      stage: "definition",
      history,
      userMessage: message,
    });
    history.push({ role: "user", content: message }, { role: "assistant", content: r.reply });
    pending = undefined;
    for (const q of r.newQuestions) {
      ctx.openQuestions.push({ stage: "definition", text: q.text, isBlocking: q.isBlocking });
    }
    console.log(`\nIdeator: ${r.reply}`);

    printOpenQuestions(r.newQuestions);

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
    console.log("Tus respuestas quedaron guardadas. Escribe 'reintentar' para volver a enviar.");
  }
  await saveSession();
}

function printOpenQuestions(newQuestions: NewQuestion[] = []) {
  if (!ctx.openQuestions.length) return;
  console.log("\nPreguntas abiertas:");
  ctx.openQuestions.forEach((q, i) =>
    console.log(`  ${i + 1}. ${q.isBlocking ? "[BLOQUEANTE] " : ""}${q.text}`)
  );
  const why = newQuestions.filter((q) => q.isBlocking);
  if (why.length) {
    console.log("\nPor qué son bloqueantes:");
    why.forEach((q) => {
      const n = ctx.openQuestions.findIndex((o) => o.text === q.text) + 1;
      console.log(`  ${n}. ${q.rationale} (afecta: ${q.affects.join(", ")})`);
    });
  }
  console.log("\nResponde con: r <número> <respuesta>");
}

async function saveSession() {
  await Deno.writeTextFile(SESION, JSON.stringify({ ctx, history, pending }, null, 2));
}

async function readSession(): Promise<
  { ctx: ProjectContext; history: ChatMessage[]; pending?: string } | undefined
> {
  try {
    return JSON.parse(await Deno.readTextFile(SESION));
  } catch {
    return undefined;
  }
}
