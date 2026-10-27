/**
 * Genera los dos documentos del proyecto de ejemplo en docs/ejemplo-salida/.
 * Uso (desde backend/): deno task docs:ejemplo
 */
import { checkConsistency } from "../src/engine/consistency.ts";
import { renderDocuments } from "../src/engine/documents.ts";
import { ejemplo } from "../src/engine/ejemplo.ts";

const ctx = ejemplo();
const issues = checkConsistency(ctx);
for (const i of issues) console.log(`[${i.severity}] ${i.description}`);

const { productSpec, architecture } = renderDocuments(ctx);
const dir = new URL("../../docs/ejemplo-salida/", import.meta.url);
await Deno.writeTextFile(new URL("especificacion-producto.md", dir), productSpec);
await Deno.writeTextFile(new URL("arquitectura.md", dir), architecture);
console.log(`Documentos generados en docs/ejemplo-salida/ (${issues.length} inconsistencias).`);
