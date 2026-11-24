/**
 * Agentes de revisión: Auditor semántico y Revisor externo.
 *
 * Los dos trabajan sobre etapas ya generadas y nunca cambian nada: reportan. Sus hallazgos
 * deben citar ids que existan en el proyecto (tool "Verificador de referencias"); si citan algo
 * inexistente, se les pide corregir. Así no pueden inventar problemas sobre cosas que no están.
 */
import type { StageKind } from "../contracts/artifacts.ts";
import type { JsonCompleter } from "./definition.ts";
import { renderDocuments } from "./documents.ts";
import type { Inconsistency, ProjectContext } from "./types.ts";
import { arr, obj, oneOf, str } from "./validate.ts";

const CONTENT: readonly StageKind[] = [
  "definition",
  "database",
  "backend",
  "frontend",
  "architecture",
];
const MAX_FINDINGS = 8;

/** Todos los ids y nombres de tabla que existen en el proyecto. */
export function knownRefs(context: ProjectContext): Set<string> {
  const s = context.stages;
  const ids = [
    ...(s.definition?.userTypes ?? []).map((r) => r.id),
    ...(s.definition?.mvp.included ?? []).map((f) => f.id),
    ...(s.definition?.requirements ?? []).map((r) => r.id),
    ...(s.definition?.businessRules ?? []).map((r) => r.id),
    ...(s.database?.entities ?? []).map((e) => e.name),
    ...(s.backend?.endpoints ?? []).map((e) => e.id),
    ...(s.frontend?.screens ?? []).map((sc) => sc.id),
  ];
  return new Set(ids);
}

/** Ids con formato de Longanizator citados en un texto (ROLE-1, REQ-3, EP-12, SCR-4…). */
export function citedIds(text: string): string[] {
  return [...text.matchAll(/\b(?:ROLE|FEAT|REQ|RULE|EP|SCR)-\d+\b/g)].map((m) => m[0]);
}

function checkRefs(text: string, known: Set<string>, path: string) {
  const cited = citedIds(text);
  if (cited.length === 0) {
    throw new Error(`${path} debe citar al menos un id del proyecto (REQ-n, RULE-n, EP-n, SCR-n…)`);
  }
  const unknown = cited.filter((id) => !known.has(id));
  if (unknown.length) {
    throw new Error(`${path} cita ids que no existen en el proyecto: ${unknown.join(", ")}`);
  }
}

function projectJson(context: ProjectContext): string {
  return CONTENT.filter((k) => k in context.stages)
    .map((k) =>
      `## Etapa ${k}\n${JSON.stringify(context.stages[k as keyof ProjectContext["stages"]])}`
    )
    .join("\n\n");
}

// ---------------------------------------------------------------- Auditor semántico
const AUDITOR = `
Eres el Auditor semántico de Longanizator. Revisas una especificación de software ya generada en
etapas (definición, base de datos, API, pantallas, arquitectura). Un validador en código ya
comprobó las referencias (que los ids existan). Tú buscas lo que el código no puede ver:
- reglas de negocio (RULE-n) que ningún endpoint ni restricción de la base hace cumplir;
- casos borde de la definición sin respuesta en la API (código de error) ni estado en pantalla;
- requisitos (REQ-n) cuyo endpoint existe pero no hace lo que el requisito pide;
- permisos de un rol que no coinciden entre definición, API y pantallas.
Reporta solo problemas reales y concretos, como máximo ${MAX_FINDINGS}, de mayor a menor
importancia. Cada hallazgo cita los ids involucrados. Si no hay problemas, devuelve una lista vacía.
Responde solo JSON: { "findings": [{ "stages": ["backend", "frontend"], "description": "…" }] }
`.trim();

export async function auditSemantics(
  complete: JsonCompleter,
  context: ProjectContext,
): Promise<Inconsistency[]> {
  const known = knownRefs(context);
  return await complete({
    system: AUDITOR,
    messages: [{ role: "user", content: projectJson(context) }],
    validate: (v) => {
      const o = obj(v, "respuesta");
      return arr(o.findings ?? [], "findings", (x, p) => {
        const f = obj(x, p);
        const description = str(f.description, `${p}.description`);
        checkRefs(description, known, `${p}.description`);
        return {
          stages: arr(f.stages, `${p}.stages`, (y, q) => oneOf(y, q, CONTENT), { min: 1 }),
          description: `[Auditor] ${description}`,
          severity: "warning" as const,
        };
      }).slice(0, MAX_FINDINGS);
    },
  });
}

// ---------------------------------------------------------------- Revisor externo
export interface ReviewFinding {
  stage: Exclude<StageKind, "review">;
  question: string;
  rationale: string;
}

const REVISOR = `
Eres el Revisor externo de Longanizator. Vas a recibir los dos documentos Markdown que otra IA usará
para implementar el producto sin poder preguntar nada. Léelos como esa IA: ¿qué decisiones
tendrías que inventar para construirlo? (un campo sin tipo, un error sin código, una pantalla
sin acción para un endpoint, una regla ambigua, un valor sin definir, una contradicción).
Reporta como máximo ${MAX_FINDINGS}, de mayor a menor impacto. Cada una es una pregunta concreta
para el equipo, cita los ids involucrados e indica la etapa donde se resolvería.
No reportes estilo ni preferencias. Si no tendrías que inventar nada, devuelve una lista vacía.
Responde solo JSON:
{ "findings": [{ "stage": "backend", "question": "¿…?", "rationale": "qué tendría que inventar" }] }
`.trim();

export async function reviewDocuments(
  complete: JsonCompleter,
  context: ProjectContext,
): Promise<ReviewFinding[]> {
  const docs = renderDocuments(context);
  const known = knownRefs(context);
  return await complete({
    system: REVISOR,
    messages: [{
      role: "user",
      content:
        `# especificacion-producto.md\n\n${docs.productSpec}\n\n# arquitectura.md\n\n${docs.architecture}`,
    }],
    validate: (v) => {
      const o = obj(v, "respuesta");
      return arr(o.findings ?? [], "findings", (x, p) => {
        const f = obj(x, p);
        const question = str(f.question, `${p}.question`);
        const rationale = str(f.rationale, `${p}.rationale`);
        checkRefs(`${question} ${rationale}`, known, p);
        return {
          stage: oneOf(f.stage, `${p}.stage`, CONTENT) as ReviewFinding["stage"],
          question,
          rationale,
        };
      }).slice(0, MAX_FINDINGS);
    },
  });
}
