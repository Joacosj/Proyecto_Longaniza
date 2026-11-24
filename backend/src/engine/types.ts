/**
 * Punto de unión entre las dos mitades del proyecto.
 *
 * - Mitad A (plataforma) guarda y lee todo desde la base de datos, expone las rutas HTTP y
 *   llama a un `Engine` para cualquier cosa que requiera IA o lógica de especificación.
 * - Mitad B (motor) implementa `Engine` en `src/engine/`. No toca HTTP ni la base de datos:
 *   recibe datos y devuelve datos.
 *
 * Mientras la mitad B no esté lista, la mitad A usa `createFakeEngine()` (engine/fake.ts).
 * Cambiar esta interfaz requiere acuerdo de ambas mitades.
 */
import type { ArchitectureTemplate, ArtifactByStage, StageKind } from "../contracts/artifacts.ts";

export type GeneratableStage = Exclude<StageKind, "review">;

/** Todo lo que el motor sabe de un proyecto. La mitad A lo arma desde la base de datos. */
export interface ProjectContext {
  projectName: string;
  initialIdea: string;
  /** Artefactos de las etapas ya trabajadas (aprobadas o en curso). */
  stages: Partial<Omit<ArtifactByStage, "review">>;
  /** Preguntas ya respondidas, para que la IA no las repita y use las respuestas. */
  answeredQuestions: { stage: StageKind; text: string; answer: string }[];
  /** Preguntas aún abiertas. */
  openQuestions: { stage: StageKind; text: string; isBlocking: boolean }[];
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

/** Pregunta detectada por el motor. La mitad A la guarda en la tabla `questions`. */
export interface NewQuestion {
  text: string;
  /** Por qué importa y qué se rompe si no se responde. */
  rationale: string;
  affects: ("database" | "backend" | "frontend" | "architecture")[];
  isBlocking: boolean;
}

/** Contradicción entre etapas. La mitad A la guarda en la tabla `inconsistencies`. */
export interface Inconsistency {
  stages: StageKind[];
  description: string;
  severity: "critical" | "warning";
}

export interface Engine {
  /**
   * Un turno de conversación en una etapa. Devuelve la respuesta de la IA, las preguntas
   * nuevas que detectó y, si ya tiene información suficiente, un borrador del artefacto.
   */
  converse(input: {
    context: ProjectContext;
    stage: GeneratableStage;
    history: ChatMessage[];
    userMessage: string;
  }): Promise<{
    reply: string;
    newQuestions: NewQuestion[];
    artifactDraft?: ArtifactByStage[GeneratableStage];
  }>;

  /**
   * Propone el artefacto completo de una etapa usando las etapas anteriores como contexto.
   * En la definición también recibe la conversación de la etapa (`history`), para que las
   * aclaraciones hechas en el chat no se pierdan al apretar "Generar con IA".
   */
  generate<K extends GeneratableStage>(input: {
    context: ProjectContext;
    stage: K;
    history?: ChatMessage[];
  }): Promise<{ artifact: ArtifactByStage[K]; questions: NewQuestion[] }>;

  /**
   * Propone un cambio mínimo en la etapa más tardía involucrada para cerrar una inconsistencia.
   * Solo devuelve "fix" si el validador confirma que se cierra sin abrir otras; si el arreglo
   * exige cambiar una etapa anterior, devuelve "manual" con la explicación.
   */
  resolveInconsistency(input: {
    context: ProjectContext;
    inconsistency: Inconsistency;
  }): Promise<
    | {
      kind: "fix";
      stage: Exclude<GeneratableStage, "definition">;
      artifact: ArtifactByStage[Exclude<GeneratableStage, "definition">];
      summary: string;
    }
    | { kind: "manual"; stage: StageKind | null; explanation: string }
  >;

  /** Auditor semántico: problemas de significado que el validador en código no ve. */
  auditSemantics(context: ProjectContext): Promise<Inconsistency[]>;

  /**
   * Revisor externo: lee los documentos finales como la IA implementadora y devuelve las
   * decisiones que tendría que inventar, como preguntas para la etapa donde se resuelven.
   */
  reviewDocuments(context: ProjectContext): Promise<
    { stage: Exclude<StageKind, "review">; question: string; rationale: string }[]
  >;

  /** Diseñador visual: HTML autocontenido y seguro que muestra cómo se vería una pantalla. */
  designScreen(input: { context: ProjectContext; screenId: string }): Promise<{ html: string }>;

  /** Revisa una etapa o todo el proyecto. Determinista: no llama a la IA. */
  checkConsistency(context: ProjectContext): Inconsistency[];

  /** Genera los dos Markdown finales. Determinista: no llama a la IA. */
  renderDocuments(context: ProjectContext): { productSpec: string; architecture: string };

  /** Catálogo de las cinco arquitecturas base. */
  listArchitectures(): ArchitectureTemplate[];
}
