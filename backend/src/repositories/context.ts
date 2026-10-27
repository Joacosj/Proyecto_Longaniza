import type { ArtifactByStage } from "../contracts/artifacts.ts";
import type { Sql } from "../db/client.ts";
import type { ProjectContext } from "../engine/types.ts";
import { questionsRepo } from "./questions.ts";
import { stagesRepo } from "./stages.ts";

/**
 * Arma desde la base todo lo que el motor necesita saber del proyecto: idea inicial,
 * artefactos de las etapas ya trabajadas (no bloqueadas y no vacías) y preguntas.
 */
export async function buildProjectContext(sql: Sql, projectId: string): Promise<ProjectContext> {
  const [project] = await sql<{ name: string; initialIdea: string }[]>`
    SELECT name, initial_idea AS "initialIdea" FROM projects WHERE id = ${projectId}`;

  const stages: ProjectContext["stages"] = {};
  for (const s of await stagesRepo(sql).listFull(projectId)) {
    if (s.kind === "review" || s.status === "locked") continue;
    if (Object.keys(s.artifact).length === 0) continue;
    (stages as Record<string, unknown>)[s.kind] = s.artifact as unknown as ArtifactByStage[
      typeof s.kind
    ];
  }

  const questions = await questionsRepo(sql).list(projectId);
  return {
    projectName: project.name,
    initialIdea: project.initialIdea,
    stages,
    answeredQuestions: questions
      .filter((q) => q.status === "answered")
      .map((q) => ({ stage: q.stageKind, text: q.text, answer: q.answer ?? "" })),
    openQuestions: questions
      .filter((q) => q.status === "open")
      .map((q) => ({ stage: q.stageKind, text: q.text, isBlocking: q.isBlocking })),
  };
}
