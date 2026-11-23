/**
 * Motor falso para que la mitad A pueda construir y probar rutas y pantallas sin esperar a la
 * mitad B.
 *
 * - `generate` devuelve la etapa correspondiente del proyecto de ejemplo (reservas de salas),
 *   que es completa y coherente.
 * - `converse` responde un texto fijo y, en la etapa de definición, una pregunta bloqueante.
 * - `checkConsistency`, `renderDocuments` y `listArchitectures` ya son los reales.
 *
 * Se reemplaza por el motor real en main.ts cuando la mitad B lo entregue.
 */
import type { ArtifactByStage } from "../contracts/artifacts.ts";
import { listArchitectures } from "./architectures.ts";
import { checkConsistency } from "./consistency.ts";
import { renderDocuments } from "./documents.ts";
import { ejemplo } from "./ejemplo.ts";
import type { Engine, GeneratableStage } from "./types.ts";

export function createFakeEngine(): Engine {
  return {
    converse: ({ stage, userMessage }) =>
      Promise.resolve({
        reply: `(motor falso) Recibí: "${userMessage}"`,
        newQuestions: stage === "definition"
          ? [{
            text: "¿Los usuarios inician sesión con una cuenta institucional o se registran?",
            rationale: "Define si se necesita la tabla de contraseñas y el flujo de SSO.",
            affects: ["database", "backend", "architecture"],
            isBlocking: true,
          }]
          : [],
      }),
    generate: <K extends GeneratableStage>({ stage }: { stage: K }) =>
      Promise.resolve({
        artifact: ejemplo().stages[stage] as ArtifactByStage[K],
        questions: [],
      }),
    resolveInconsistency: ({ inconsistency }) =>
      Promise.resolve({
        kind: "manual" as const,
        stage: inconsistency.stages.at(-1) ?? null,
        explanation: "(motor falso) Resolver con IA necesita el motor real.",
      }),
    checkConsistency: (ctx) => checkConsistency(ctx),
    renderDocuments: (ctx) => renderDocuments(ctx),
    listArchitectures,
  };
}
