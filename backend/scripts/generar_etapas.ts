/**
 * Genera con la IA real las etapas 2 a 5 y los dos documentos finales, a partir de la
 * definición que dejó `deno task conversar`.
 * Uso (desde backend/): deno task generar          (retoma lo ya generado)
 *                       deno task generar --rehacer (vuelve a generar todo)
 *
 * Todo queda en backend/salida/: un JSON por etapa y los dos Markdown.
 */
import type { DefinitionArtifact } from "../src/contracts/artifacts.ts";
import { checkConsistency, hasCritical } from "../src/engine/consistency.ts";
import { renderDocuments } from "../src/engine/documents.ts";
import { generateStage } from "../src/engine/generate.ts";
import { completeJson, LlmError, loadLlmConfig } from "../src/engine/llm.ts";
import type { ProjectContext } from "../src/engine/types.ts";

const SALIDA = "salida";
const STAGES = ["database", "backend", "frontend", "architecture"] as const;
const NAMES = {
  database: "base de datos",
  backend: "backend y API",
  frontend: "pantallas",
  architecture: "arquitectura",
};
const rehacer = Deno.args.includes("--rehacer");

const ctx = await loadContext();
const config = loadLlmConfig();
await Deno.mkdir(SALIDA, { recursive: true });
console.log(`Proyecto: ${ctx.projectName}\n`);

for (const stage of STAGES) {
  const file = `${SALIDA}/${stage}.json`;
  if (!rehacer && await exists(file)) {
    (ctx.stages as Record<string, unknown>)[stage] = JSON.parse(await Deno.readTextFile(file));
    console.log(`✓ ${NAMES[stage]}: ya generada (${file})`);
    continue;
  }
  console.log(`… ${NAMES[stage]}: generando (puede tardar algunos minutos)`);
  const started = performance.now();
  try {
    const { artifact, questions } = await generateStage(
      (opts) => completeJson(config, opts),
      { context: ctx, stage },
    );
    (ctx.stages as Record<string, unknown>)[stage] = artifact;
    await Deno.writeTextFile(file, JSON.stringify(artifact, null, 2));
    const secs = Math.round((performance.now() - started) / 1000);
    console.log(`✓ ${NAMES[stage]}: lista en ${secs} s → ${resumen(stage, artifact)}`);
    for (const q of questions) {
      console.log(
        `    ${q.isBlocking ? "[BLOQUEANTE] " : "[pregunta] "}${q.text} (${q.rationale})`,
      );
    }
  } catch (e) {
    console.log(`✗ ${NAMES[stage]}: ${e instanceof LlmError ? `${e.kind}: ${e.message}` : e}`);
    console.log("  Vuelve a ejecutar 'deno task generar' para reintentar desde esta etapa.");
    Deno.exit(1);
  }
}

const issues = checkConsistency(ctx);
console.log(`\nConsistencia entre etapas: ${issues.length ? "" : "sin problemas"}`);
issues.forEach((i) => console.log(`  [${i.severity}] ${i.description}`));

if (hasCritical(issues)) {
  console.log("\nHay inconsistencias críticas: no se generan los documentos finales.");
  Deno.exit(1);
}
const docs = renderDocuments(ctx);
await Deno.writeTextFile(`${SALIDA}/especificacion-producto.md`, docs.productSpec);
await Deno.writeTextFile(`${SALIDA}/arquitectura.md`, docs.architecture);
console.log(
  `\nDocumentos finales en backend/${SALIDA}/: especificacion-producto.md y arquitectura.md`,
);

// ------------------------------------------------------------------ utilidades
async function loadContext(): Promise<ProjectContext> {
  // La sesión de 'conversar' trae nombre, idea y preguntas respondidas; el borrador, la definición.
  // Se combinan para que los documentos no pierdan el nombre ni las decisiones confirmadas.
  const session = await readJson<{ ctx?: ProjectContext }>("definicion-sesion.json");
  const draft = await readJson<DefinitionArtifact>("definicion-borrador.json");
  const definition = session?.ctx?.stages?.definition ?? draft;
  if (!definition) {
    console.log(
      "No hay definición: primero ejecuta 'deno task conversar' hasta obtener el borrador.",
    );
    Deno.exit(1);
  }
  if (!session?.ctx) {
    console.log(
      "Aviso: no está definicion-sesion.json; el nombre y las decisiones confirmadas no aparecerán.",
    );
  }
  return {
    projectName: session?.ctx?.projectName ?? "Proyecto",
    initialIdea: session?.ctx?.initialIdea ?? definition.problem.statement,
    answeredQuestions: session?.ctx?.answeredQuestions ?? [],
    openQuestions: [],
    stages: { definition },
  };
}

async function readJson<T>(path: string): Promise<T | undefined> {
  try {
    return JSON.parse(await Deno.readTextFile(path)) as T;
  } catch {
    return undefined;
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}

function resumen(stage: (typeof STAGES)[number], a: unknown): string {
  const x = a as Record<string, unknown[]> & { selectedKey?: string; stack?: { backend: string } };
  if (stage === "database") {
    return `${x.entities.length} tablas, ${x.relationships.length} relaciones`;
  }
  if (stage === "backend") return `${x.endpoints.length} endpoints`;
  if (stage === "frontend") return `${x.screens.length} pantallas`;
  return `${x.selectedKey} (${x.stack?.backend})`;
}
