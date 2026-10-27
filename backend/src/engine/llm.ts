/**
 * Cliente de IA para Microsoft Foundry, usando su API compatible con OpenAI (ruta /openai/v1).
 *
 * Todas las etapas del motor pasan por `completeJson`: la IA siempre responde un objeto JSON,
 * que se valida antes de devolverlo. Si la respuesta no es JSON o no pasa la validación, se le
 * pide a la IA que la corrija una vez.
 */

export interface LlmConfig {
  /** Ej: https://<recurso>.openai.azure.com/openai/v1 */
  baseUrl: string;
  apiKey: string;
  /** Nombre del deployment en Foundry. */
  model: string;
  timeoutMs: number;
  /** Reintentos ante 429 o errores 5xx. */
  maxRetries: number;
  retryBaseMs: number;
}

export type LlmErrorKind =
  | "config"
  | "auth"
  | "rate_limit"
  | "timeout"
  | "network"
  | "http"
  | "bad_response";

export class LlmError extends Error {
  constructor(readonly kind: LlmErrorKind, message: string, readonly status?: number) {
    super(message);
    this.name = "LlmError";
  }
}

export interface LlmMessage {
  role: "user" | "assistant";
  content: string;
}

export function loadLlmConfig(
  env: (k: string) => string | undefined = (k) => Deno.env.get(k),
): LlmConfig {
  const baseUrl = env("LLM_BASE_URL")?.trim().replace(/\/+$/, "");
  const apiKey = env("LLM_API_KEY")?.trim();
  const model = env("LLM_MODEL")?.trim();
  const missing = [
    !baseUrl && "LLM_BASE_URL",
    !apiKey && "LLM_API_KEY",
    !model && "LLM_MODEL",
  ].filter(Boolean);
  if (missing.length) {
    throw new LlmError("config", `Faltan variables de entorno: ${missing.join(", ")}`);
  }
  return {
    baseUrl: baseUrl!,
    apiKey: apiKey!,
    model: model!,
    // Generar una etapa completa con un modelo que razona puede tardar varios minutos.
    timeoutMs: Number(env("LLM_TIMEOUT_MS") ?? 300_000),
    maxRetries: 3,
    retryBaseMs: 1_000,
  };
}

export interface CompleteJsonOptions<T> {
  system: string;
  messages: LlmMessage[];
  /** Valida y tipa el objeto. Debe lanzar un Error con un mensaje claro si no es válido. */
  validate: (value: unknown) => T;
  temperature?: number;
  /** Para pruebas. */
  fetchFn?: typeof fetch;
}

const JSON_RULE = "\n\nResponde únicamente con un objeto JSON válido, sin texto adicional ni " +
  "bloques de código.";

export async function completeJson<T>(cfg: LlmConfig, opts: CompleteJsonOptions<T>): Promise<T> {
  const doFetch = opts.fetchFn ?? fetch;
  const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
    { role: "system", content: opts.system + JSON_RULE },
    ...opts.messages,
  ];

  // Un intento normal y uno de corrección.
  for (let attempt = 0; attempt < 2; attempt++) {
    const content = await chat(cfg, doFetch, messages, opts.temperature);
    try {
      return opts.validate(parseJson(content));
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      if (attempt === 1) {
        throw new LlmError("bad_response", `La IA devolvió una respuesta inválida: ${reason}`);
      }
      messages.push(
        { role: "assistant", content },
        {
          role: "user",
          content: `Tu respuesta no es válida: ${reason}. Corrígela y responde solo el JSON.`,
        },
      );
    }
  }
  throw new LlmError("bad_response", "Respuesta inválida"); // inalcanzable
}

async function chat(
  cfg: LlmConfig,
  doFetch: typeof fetch,
  messages: { role: string; content: string }[],
  temperature?: number,
): Promise<string> {
  const body = JSON.stringify({
    model: cfg.model,
    messages,
    response_format: { type: "json_object" },
    ...(temperature === undefined ? {} : { temperature }),
  });

  for (let retry = 0;; retry++) {
    let res: Response;
    try {
      res = await doFetch(`${cfg.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "api-key": cfg.apiKey },
        body,
        signal: AbortSignal.timeout(cfg.timeoutMs),
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === "TimeoutError") {
        throw new LlmError("timeout", `La IA no respondió en ${cfg.timeoutMs} ms`);
      }
      throw new LlmError("network", `No se pudo conectar con la IA: ${(err as Error).message}`);
    }

    if (res.ok) {
      const data = await res.json().catch(() => null);
      const content = data?.choices?.[0]?.message?.content;
      if (typeof content !== "string" || !content.trim()) {
        throw new LlmError("bad_response", "La IA respondió sin contenido");
      }
      return content;
    }

    const detail = await res.text().catch(() => "");
    const retryable = res.status === 429 || res.status >= 500;
    if (retryable && retry < cfg.maxRetries) {
      const retryAfter = Number(res.headers.get("retry-after"));
      const wait = Number.isFinite(retryAfter) && retryAfter > 0
        ? Math.min(retryAfter * 1000, 30_000)
        : cfg.retryBaseMs * 2 ** retry;
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }

    if (res.status === 401 || res.status === 403) {
      throw new LlmError("auth", "La API key no es válida o no tiene acceso", res.status);
    }
    if (res.status === 404) {
      throw new LlmError(
        "config",
        `No existe el deployment "${cfg.model}" o LLM_BASE_URL es incorrecta`,
        404,
      );
    }
    if (res.status === 429) {
      throw new LlmError("rate_limit", "Se alcanzó el límite de uso de la IA", 429);
    }
    throw new LlmError(
      "http",
      `La IA respondió ${res.status}: ${detail.slice(0, 300)}`,
      res.status,
    );
  }
}

/** Acepta JSON puro o envuelto en un bloque ```json por si el modelo lo agrega igual. */
function parseJson(content: string): unknown {
  const trimmed = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(trimmed);
  } catch {
    throw new Error("no es JSON válido");
  }
}
