/**
 * "Resolver con IA": propone un cambio mínimo en UNA etapa para cerrar una inconsistencia.
 *
 * Reglas:
 * - Se modifica solo la etapa más tardía involucrada (la que depende de las otras). Las etapas
 *   anteriores ya aprobadas no se tocan: si el arreglo exige cambiarlas, se explica y el equipo
 *   decide (resultado "manual").
 * - La IA propone; el código decide. Una propuesta solo se acepta si la inconsistencia
 *   desaparece y no aparece ninguna nueva (`checkResolution`).
 */
import {
  type ArchitectureTemplate,
  type ArtifactByStage,
  STAGE_ORDER,
  type StageKind,
} from "../contracts/artifacts.ts";
import { ARCHITECTURES } from "./architectures.ts";
import { checkConsistency } from "./consistency.ts";
import type { JsonCompleter } from "./definition.ts";
import { stageSystemPrompt } from "./prompts/stages.ts";
import type { GeneratableStage, Inconsistency, ProjectContext } from "./types.ts";
import {
  obj,
  oneOf,
  parseArchitectureArtifact,
  parseBackendArtifact,
  parseDatabaseArtifact,
  parseFrontendArtifact,
  str,
} from "./validate.ts";

type LaterStage = Exclude<GeneratableStage, "definition">;

const PARSERS: { [K in LaterStage]: (v: unknown, path: string) => ArtifactByStage[K] } = {
  database: parseDatabaseArtifact,
  backend: parseBackendArtifact,
  frontend: parseFrontendArtifact,
  architecture: parseArchitectureArtifact,
};

const LATER: readonly LaterStage[] = ["database", "backend", "frontend", "architecture"];

export type ResolveResult =
  | { kind: "fix"; stage: LaterStage; artifact: ArtifactByStage[LaterStage]; summary: string }
  | { kind: "manual"; stage: StageKind | null; explanation: string };

const keyOf = (i: Inconsistency) =>
  `${i.severity}|${[...i.stages].sort().join(",")}|${i.description}`;

/** La etapa más tardía de las involucradas: es la única que el resolver puede cambiar. */
export function targetStage(inc: Inconsistency): StageKind | undefined {
  return [...inc.stages].sort((a, b) => STAGE_ORDER.indexOf(b) - STAGE_ORDER.indexOf(a))[0];
}

/**
 * ¿Reemplazar la etapa `stage` por `artifact` cierra `inc` sin abrir otras? Devuelve el motivo
 * del rechazo, o null si se acepta. También lo usa la ruta que aplica el cambio.
 */
export function checkResolution(
  context: ProjectContext,
  inc: Inconsistency,
  stage: LaterStage,
  artifact: unknown,
  catalog: readonly ArchitectureTemplate[] = ARCHITECTURES,
): { reason: string | null; after: Inconsistency[] } {
  const before = new Set(checkConsistency(context, catalog).map(keyOf));
  const after = checkConsistency(
    { ...context, stages: { ...context.stages, [stage]: artifact } },
    catalog,
  );
  if (after.some((i) => keyOf(i) === keyOf(inc))) {
    return { reason: `la inconsistencia sigue presente: ${inc.description}`, after };
  }
  const fresh = after.filter((i) => !before.has(keyOf(i)));
  if (fresh.length) {
    return {
      reason: "el cambio crea inconsistencias nuevas: " + fresh.map((i) => i.description).join(" "),
      after,
    };
  }
  return { reason: null, after };
}

const RESOLVE_RULES = `
## Tarea: resolver una inconsistencia
No generes la etapa desde cero. Recibes la versión actual de la etapa y una inconsistencia que
la involucra. Haz el cambio MÍNIMO para resolverla:
- Conserva todo lo demás tal cual: mismos ids, nombres, textos y orden.
- No agregues funcionalidades nuevas ni toques nada no relacionado.
- Si se puede resolver en esta etapa, responde:
  { "action": "fix", "summary": "qué cambiaste, en una o dos frases", "artifact": { …etapa completa… } }
- Si resolverla exige cambiar una etapa ANTERIOR (por ejemplo, agregar una tabla o un endpoint
  que no existe), no la cambies; responde:
  { "action": "manual", "stage": "<etapa que habría que cambiar>", "explanation": "qué habría que cambiar y por qué" }
`.trim();

export async function resolveInconsistency(
  complete: JsonCompleter,
  input: { context: ProjectContext; inconsistency: Inconsistency },
  catalog: readonly ArchitectureTemplate[] = ARCHITECTURES,
): Promise<ResolveResult> {
  const { context, inconsistency: inc } = input;
  const stage = targetStage(inc);
  if (!stage || !(LATER as readonly string[]).includes(stage)) {
    return {
      kind: "manual",
      stage: stage ?? null,
      explanation:
        "Esta inconsistencia está dentro de la definición del producto: corrígela conversando " +
        "con la IA en la etapa 1 o editándola directamente.",
    };
  }
  const target = stage as LaterStage;
  if (!context.stages[target]) {
    return {
      kind: "manual",
      stage: target,
      explanation: `La etapa "${target}" todavía no tiene contenido: genérala primero.`,
    };
  }

  const lines = [
    `# Proyecto: ${context.projectName}`,
    "",
    "## Inconsistencia a resolver",
    `[${inc.severity}] ${inc.description} (etapas: ${inc.stages.join(", ")})`,
    "",
    `## Etapa que puedes cambiar: ${target}`,
    JSON.stringify(context.stages[target]),
  ];
  for (const s of LATER.filter((s) => s !== target)) {
    const a = context.stages[s];
    if (a) lines.push("", `## Etapa ${s} (no la cambies)`, JSON.stringify(a));
  }
  if (context.stages.definition) {
    lines.push(
      "",
      "## Definición del producto (no la cambies)",
      JSON.stringify(context.stages.definition),
    );
  }
  if (target === "architecture") {
    lines.push("", "## Catálogo de arquitecturas base", JSON.stringify(catalog));
  }

  return await complete({
    system: `${stageSystemPrompt(target)}\n\n${RESOLVE_RULES}`,
    messages: [{ role: "user", content: lines.join("\n") }],
    validate: (v): ResolveResult => {
      const o = obj(v, "respuesta");
      const action = oneOf(o.action, "action", ["fix", "manual"] as const);
      if (action === "manual") {
        return {
          kind: "manual",
          stage: typeof o.stage === "string" && (STAGE_ORDER as string[]).includes(o.stage)
            ? o.stage as StageKind
            : null,
          explanation: str(o.explanation, "explanation"),
        };
      }
      const artifact = PARSERS[target](o.artifact, "artifact");
      const { reason } = checkResolution(context, inc, target, artifact, catalog);
      if (reason) throw new Error(reason);
      return { kind: "fix", stage: target, artifact, summary: str(o.summary, "summary") };
    },
  });
}

/** Lista legible de lo que cambia entre dos versiones de una etapa (por id o nombre). */
export function describeChanges(before: unknown, after: unknown): string[] {
  const b = (before ?? {}) as Record<string, unknown>;
  const a = (after ?? {}) as Record<string, unknown>;
  const label = (x: unknown) => {
    const o = x as Record<string, unknown>;
    return String(o?.id ?? o?.name ?? o?.featureId ?? "");
  };
  const out: string[] = [];
  for (const key of new Set([...Object.keys(b), ...Object.keys(a)])) {
    if (JSON.stringify(b[key]) === JSON.stringify(a[key])) continue;
    const bv = b[key], av = a[key];
    if (Array.isArray(bv) && Array.isArray(av) && [...bv, ...av].every((x) => label(x))) {
      const bm = new Map(bv.map((x) => [label(x), JSON.stringify(x)]));
      const am = new Map(av.map((x) => [label(x), JSON.stringify(x)]));
      for (const [id, val] of am) {
        if (!bm.has(id)) out.push(`Agrega ${id} en ${key}`);
        else if (bm.get(id) !== val) out.push(`Modifica ${id} en ${key}`);
      }
      for (const id of bm.keys()) if (!am.has(id)) out.push(`Quita ${id} de ${key}`);
    } else {
      out.push(`Modifica ${key}`);
    }
  }
  return out;
}
