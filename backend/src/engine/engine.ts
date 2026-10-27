/**
 * Motor real de Ideator. Reemplaza a createFakeEngine() en main.ts.
 *
 * Estado: la etapa de definición (converse) está implementada. La generación de las etapas
 * siguientes (generate) es la tarea B7; mientras tanto devuelve las del proyecto de ejemplo
 * para que la plataforma pueda probar el flujo completo.
 */
import type { ArtifactByStage } from "../contracts/artifacts.ts";
import { listArchitectures } from "./architectures.ts";
import { checkConsistency } from "./consistency.ts";
import { converseDefinition, type JsonCompleter } from "./definition.ts";
import { renderDocuments } from "./documents.ts";
import { ejemplo } from "./ejemplo.ts";
import { completeJson, type LlmConfig, loadLlmConfig } from "./llm.ts";
import type { Engine, GeneratableStage } from "./types.ts";

export function createEngine(complete: JsonCompleter): Engine {
  return {
    converse: async ({ context, stage, history, userMessage }) => {
      if (stage !== "definition") {
        // Las demás etapas se generan con generate(); la conversación es para la definición.
        return {
          reply: "En esta etapa usa 'Generar propuesta' y luego edita el resultado.",
          newQuestions: [],
        };
      }
      return await converseDefinition(complete, { context, history, userMessage });
    },
    generate: <K extends GeneratableStage>({ stage }: { stage: K }) =>
      // TODO(B7): generar con la IA a partir de las etapas anteriores.
      Promise.resolve({
        artifact: ejemplo().stages[stage] as ArtifactByStage[K],
        questions: [],
      }),
    checkConsistency: (ctx) => checkConsistency(ctx),
    renderDocuments: (ctx) => renderDocuments(ctx),
    listArchitectures,
  };
}

/** Motor conectado a Microsoft Foundry según las variables LLM_* del entorno. */
export function createEngineFromEnv(config: LlmConfig = loadLlmConfig()): Engine {
  return createEngine((opts) => completeJson(config, opts));
}
