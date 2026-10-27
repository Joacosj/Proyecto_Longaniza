/**
 * Etapas 2 a 5: la IA propone el artefacto completo a partir de las etapas anteriores.
 *
 * El código valida el formato y la consistencia con las etapas previas. Si hay contradicciones
 * críticas que involucran a la etapa generada (por ejemplo, un endpoint que usa una tabla que
 * no existe), se le devuelven a la IA para que corrija una vez.
 */
import type { ArchitectureTemplate, ArtifactByStage } from "../contracts/artifacts.ts";
import { ARCHITECTURES } from "./architectures.ts";
import { checkConsistency } from "./consistency.ts";
import type { JsonCompleter } from "./definition.ts";
import { previousStages, stageContextMessage, stageSystemPrompt } from "./prompts/stages.ts";
import type { GeneratableStage, NewQuestion, ProjectContext } from "./types.ts";
import {
  arr,
  obj,
  parseArchitectureArtifact,
  parseBackendArtifact,
  parseDatabaseArtifact,
  parseFrontendArtifact,
  parseNewQuestion,
} from "./validate.ts";

type LaterStage = Exclude<GeneratableStage, "definition">;

const PARSERS: { [K in LaterStage]: (v: unknown, path: string) => ArtifactByStage[K] } = {
  database: parseDatabaseArtifact,
  backend: parseBackendArtifact,
  frontend: parseFrontendArtifact,
  architecture: parseArchitectureArtifact,
};

export async function generateStage<K extends LaterStage>(
  complete: JsonCompleter,
  input: { context: ProjectContext; stage: K },
  catalog: readonly ArchitectureTemplate[] = ARCHITECTURES,
): Promise<{ artifact: ArtifactByStage[K]; questions: NewQuestion[] }> {
  const { context, stage } = input;
  const missing = previousStages(stage).filter((s) => !(s in context.stages));
  if (missing.length) {
    throw new Error(`No se puede generar "${stage}": faltan las etapas ${missing.join(", ")}`);
  }

  return await complete({
    system: stageSystemPrompt(stage),
    messages: [{ role: "user", content: stageContextMessage(context, stage, catalog) }],
    validate: (v) => {
      const o = obj(v, "respuesta");
      const artifact = PARSERS[stage](o.artifact, "artifact") as ArtifactByStage[K];
      const questions = arr(o.questions ?? [], "questions", parseNewQuestion);

      // Solo las contradicciones en las que participa esta etapa: las de etapas anteriores
      // no las puede arreglar la IA desde aquí.
      const stages = { ...context.stages, [stage]: artifact };
      const critical = checkConsistency({ ...context, stages }, catalog)
        .filter((i) => i.severity === "critical" && i.stages.includes(stage));
      if (critical.length) {
        throw new Error(
          "la propuesta contradice las etapas anteriores: " +
            critical.map((i) => i.description).join(" "),
        );
      }
      return { artifact, questions };
    },
  });
}
