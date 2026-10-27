/**
 * Etapa 1: conversación para definir el producto y detectar preguntas bloqueantes.
 *
 * Además de lo que pide el prompt, el código aplica reglas que no se dejan a criterio de la IA:
 * - La respuesta debe tener el formato correcto; si no, se le pide corregirla (ver llm.ts).
 * - Un borrador con contradicciones internas (ids inexistentes, requisitos huérfanos) se
 *   rechaza y se le pide a la IA corregirlo.
 * - Las preguntas repetidas (ya abiertas o ya respondidas) se descartan.
 * - Si queda alguna pregunta bloqueante abierta, no se entrega borrador: Ideator no puede
 *   completar la definición suponiendo decisiones importantes.
 */
import type { DefinitionArtifact } from "../contracts/artifacts.ts";
import { checkConsistency } from "./consistency.ts";
import type { LlmMessage } from "./llm.ts";
import { DEFINITION_SYSTEM_PROMPT, definitionMessages } from "./prompts/definition.ts";
import type { ChatMessage, NewQuestion, ProjectContext } from "./types.ts";
import { arr, obj, parseDefinitionArtifact, parseNewQuestion, str } from "./validate.ts";

/** Función que llama a la IA y valida su JSON. En producción es `completeJson` con la config. */
export type JsonCompleter = <T>(opts: {
  system: string;
  messages: LlmMessage[];
  validate: (value: unknown) => T;
}) => Promise<T>;

export interface DefinitionTurn {
  reply: string;
  newQuestions: NewQuestion[];
  artifactDraft?: DefinitionArtifact;
}

const MAX_QUESTIONS_PER_TURN = 4;

export async function converseDefinition(
  complete: JsonCompleter,
  input: { context: ProjectContext; history: ChatMessage[]; userMessage: string },
): Promise<DefinitionTurn> {
  const { context } = input;

  const raw = await complete({
    system: DEFINITION_SYSTEM_PROMPT,
    messages: definitionMessages(context, input.history, input.userMessage),
    validate: (v) => parseTurn(v, context),
  });

  const known = new Set(
    [...context.openQuestions, ...context.answeredQuestions].map((q) => normalize(q.text)),
  );
  const newQuestions: NewQuestion[] = [];
  for (const q of raw.newQuestions) {
    const key = normalize(q.text);
    if (known.has(key)) continue;
    known.add(key);
    newQuestions.push(q);
  }
  // Bloqueantes primero, y no más del máximo por turno.
  newQuestions.sort((a, b) => Number(b.isBlocking) - Number(a.isBlocking));
  newQuestions.splice(MAX_QUESTIONS_PER_TURN);

  const blockingPending = context.openQuestions.some((q) => q.isBlocking) ||
    newQuestions.some((q) => q.isBlocking);

  return {
    reply: raw.reply,
    newQuestions,
    artifactDraft: blockingPending ? undefined : raw.artifactDraft,
  };
}

function parseTurn(v: unknown, context: ProjectContext): DefinitionTurn {
  const o = obj(v, "respuesta");
  const turn: DefinitionTurn = {
    reply: str(o.reply, "reply"),
    newQuestions: arr(o.newQuestions ?? [], "newQuestions", parseNewQuestion),
  };
  if (o.artifactDraft !== null && o.artifactDraft !== undefined) {
    const draft = parseDefinitionArtifact(o.artifactDraft, "artifactDraft");
    const critical = checkConsistency({ ...context, stages: { definition: draft } })
      .filter((i) => i.severity === "critical");
    if (critical.length) {
      throw new Error(
        "el borrador tiene contradicciones: " + critical.map((i) => i.description).join(" "),
      );
    }
    turn.artifactDraft = draft;
  }
  return turn;
}

/** Para comparar preguntas sin importar mayúsculas, tildes ni signos. */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9ñ ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
