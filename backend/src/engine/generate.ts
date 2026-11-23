/**
 * Etapas 2 a 5: la IA propone el artefacto completo a partir de las etapas anteriores.
 *
 * El código valida el formato y la consistencia con las etapas previas. Si hay contradicciones
 * críticas que involucran a la etapa generada (por ejemplo, un endpoint que usa una tabla que
 * no existe), se le devuelven a la IA para que corrija.
 *
 * Prevención de advertencias: las que esta etapa puede arreglar (es la más tardía de las
 * involucradas, como un endpoint que ninguna pantalla usa) también se devuelven en las primeras
 * rondas. En la última se acepta igual, para no trabar al usuario por un detalle: la advertencia
 * queda registrada y se puede resolver después en la revisión.
 */
import type { ArchitectureTemplate, ArtifactByStage } from "../contracts/artifacts.ts";
import { ARCHITECTURES } from "./architectures.ts";
import { checkConsistency } from "./consistency.ts";
import type { JsonCompleter } from "./definition.ts";
import { previousStages, stageContextMessage, stageSystemPrompt } from "./prompts/stages.ts";
import type { GeneratableStage, Inconsistency, NewQuestion, ProjectContext } from "./types.ts";
import { STAGE_ORDER } from "../contracts/artifacts.ts";
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

  // completeJson hace hasta 3 intentos; las advertencias se exigen en los 2 primeros.
  let attempt = 0;
  const fixableHere = (i: Inconsistency) =>
    i.stages.includes(stage) &&
    i.stages.every((s) => STAGE_ORDER.indexOf(s) <= STAGE_ORDER.indexOf(stage));

  return await complete({
    system: stageSystemPrompt(stage),
    messages: [{ role: "user", content: stageContextMessage(context, stage, catalog) }],
    validate: (v) => {
      const o = obj(v, "respuesta");
      const artifact = PARSERS[stage](o.artifact, "artifact") as ArtifactByStage[K];
      const questions = arr(o.questions ?? [], "questions", parseNewQuestion);

      // Solo las contradicciones en las que participa esta etapa: las de etapas anteriores
      // no las puede arreglar la IA desde aquí.
      attempt++;
      const stages = { ...context.stages, [stage]: artifact };
      const issues = checkConsistency({ ...context, stages }, catalog);
      const critical = issues.filter((i) => i.severity === "critical" && i.stages.includes(stage));
      if (critical.length) {
        throw new Error(
          "la propuesta contradice las etapas anteriores: " +
            critical.map((i) => i.description).join(" "),
        );
      }
      const warnings = issues.filter((i) => i.severity === "warning" && fixableHere(i));
      if (warnings.length && attempt < 3) {
        throw new Error(
          "la propuesta deja advertencias que puedes resolver en esta etapa (corrígelas o, si de " +
            "verdad no aplican, deja la propuesta igual): " +
            warnings.map((i) => i.description).join(" "),
        );
      }
      return { artifact, questions };
    },
  });
}
