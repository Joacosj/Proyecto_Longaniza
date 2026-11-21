/**
 * Prueba de conexión con la IA. Uso (desde backend/): deno task llm:ping
 * Lee la configuración de la IA (LLM_*, GCP_*) del archivo .env en la raíz del repositorio.
 */
import { completeJson, LlmError, loadLlmConfig, providerLabel } from "./llm.ts";

try {
  const cfg = loadLlmConfig();
  if (cfg.provider === "foundry") {
    console.warn(
      "Aviso: el .env apunta a Microsoft Foundry, que ya no está disponible. Para Google Cloud, " +
        "completa GCP_PROJECT_ID y GOOGLE_APPLICATION_CREDENTIALS y borra LLM_BASE_URL y " +
        "LLM_API_KEY (ver docs/google-cloud.md).",
    );
  }
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
