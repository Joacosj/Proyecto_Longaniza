/**
 * Motor real de Ideator.
 *
 * - converse: conversación de la etapa de definición (definition.ts).
 * - generate: definición → borrador a partir de lo conversado; demás etapas → propuesta
 *   completa a partir de las anteriores (generate.ts).
 * - checkConsistency, renderDocuments, listArchitectures: deterministas, sin IA.
 *
 * Los errores de la IA se convierten en ApiError con un mensaje claro para la interfaz.
 */
import type { ArtifactByStage } from "../contracts/artifacts.ts";
import { ApiError } from "../http/errors.ts";
import { listArchitectures } from "./architectures.ts";
import { checkConsistency } from "./consistency.ts";
import { converseDefinition, type JsonCompleter } from "./definition.ts";
import { renderDocuments } from "./documents.ts";
import { generateStage } from "./generate.ts";
import { resolveInconsistency } from "./resolve.ts";
import { completeJson, type LlmConfig, LlmError, loadLlmConfig } from "./llm.ts";
import type { Engine, GeneratableStage } from "./types.ts";

export function createEngine(complete: JsonCompleter): Engine {
  return {
    converse: ({ context, stage, history, userMessage }) =>
      withFriendlyErrors(async () => {
        if (stage !== "definition") {
          return {
            reply: 'En esta etapa usa "Generar con IA" y luego edita el resultado.',
            newQuestions: [],
          };
        }
        return await converseDefinition(complete, { context, history, userMessage });
      }),

    generate: <K extends GeneratableStage>(
      { context, stage }: { context: Parameters<Engine["generate"]>[0]["context"]; stage: K },
    ) =>
      withFriendlyErrors(async () => {
        if (stage === "definition") {
          const turn = await converseDefinition(complete, {
            context,
            history: [],
            userMessage: "Con la información y las respuestas disponibles, entrega el borrador " +
              "completo de la definición.",
          });
          if (!turn.artifactDraft) {
            throw new ApiError(
              "CONFLICT",
              "La IA necesita algunas decisiones antes de proponer la definición. Responde las " +
                "preguntas del panel Preguntas (o conversa con ella) y vuelve a generar.",
              { questions: turn.newQuestions },
            );
          }
          return {
            artifact: turn.artifactDraft as ArtifactByStage[K],
            questions: turn.newQuestions,
          };
        }
        const out = await generateStage(complete, {
          context,
          stage: stage as Exclude<GeneratableStage, "definition">,
        });
        return { artifact: out.artifact as ArtifactByStage[K], questions: out.questions };
      }),

    resolveInconsistency: (input) =>
      withFriendlyErrors(() => resolveInconsistency(complete, input)),

    checkConsistency: (ctx) => checkConsistency(ctx),
    renderDocuments: (ctx) => renderDocuments(ctx),
    listArchitectures,
  };
}

/** Motor conectado a la IA configurada en el entorno (Google Cloud por defecto; ver llm.ts). */
export function createEngineFromEnv(config: LlmConfig = loadLlmConfig()): Engine {
  return createEngine((opts) => completeJson(config, opts));
}

const FRIENDLY: Record<LlmError["kind"], string> = {
  config: "La IA no está bien configurada",
  auth: "Las credenciales de la IA no son válidas o no tienen acceso",
  rate_limit: "Se alcanzó el límite de uso de la IA; intenta en unos minutos",
  timeout: "La IA tardó demasiado en responder; intenta de nuevo",
  network: "No se pudo conectar con la IA",
  http: "La IA respondió con un error",
  bad_response: "La IA entregó una respuesta inválida; intenta de nuevo",
};

async function withFriendlyErrors<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof LlmError) {
      console.error(`[motor] ${e.kind}: ${e.message}`);
      // Para respuestas inválidas se muestra el motivo: ayuda a decidir si reintentar o ajustar
      // una etapa anterior. No contiene datos sensibles (son mensajes del validador).
      const detail = e.kind === "bad_response"
        ? ` Motivo: ${
          e.message.replace(/^La IA devolvió una respuesta inválida: /, "").slice(0, 300)
        }`
        : "";
      throw new ApiError("INTERNAL", `${FRIENDLY[e.kind]}.${detail}`, { reason: e.kind });
    }
    throw e;
  }
}
