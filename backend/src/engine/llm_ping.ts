/**
 * Prueba de conexión con la IA. Uso (desde backend/): deno task llm:ping
 * Lee la configuración de la IA (LLM_*, GCP_*) del archivo .env en la raíz del repositorio.
 */
import { completeJson, LlmError, loadLlmConfig, providerLabel } from "./llm.ts";

try {
  const cfg = loadLlmConfig();
  console.log(`Conectando a ${providerLabel(cfg)} con el modelo "${cfg.model}"...`);
  const started = performance.now();
  const result = await completeJson(cfg, {
    system: "Eres un asistente de prueba.",
    messages: [{
      role: "user",
      content: 'Devuelve {"ok": true, "saludo": "<un saludo corto en español>"}',
    }],
    validate: (v) => {
      const o = v as { ok?: unknown; saludo?: unknown };
      if (o?.ok !== true || typeof o.saludo !== "string") {
        throw new Error('se esperaba {"ok": true, "saludo": string}');
      }
      return o as { ok: true; saludo: string };
    },
  });
  console.log(`Conexión correcta en ${Math.round(performance.now() - started)} ms.`);
  console.log(`Respuesta: ${result.saludo}`);
} catch (err) {
  if (err instanceof LlmError) {
    console.error(`Error (${err.kind}): ${err.message}`);
  } else {
    console.error(err);
  }
  Deno.exit(1);
}
