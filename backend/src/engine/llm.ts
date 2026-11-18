/**
 * Cliente de IA para cualquier API compatible con OpenAI (Chat Completions).
 *
 * Proveedores (LLM_PROVIDER, o se deduce de las variables presentes):
 * - vertex:  Google Cloud Vertex AI. Usa una cuenta de servicio (GOOGLE_APPLICATION_CREDENTIALS),
 *            GCP_PROJECT_ID y GCP_LOCATION; consume los créditos del proyecto de Google Cloud.
 * - openai:  cualquier API con "Authorization: Bearer <LLM_API_KEY>" (ej. Gemini en AI Studio).
 * - foundry: Microsoft Foundry, con el encabezado "api-key".
 *
 * Todas las etapas del motor pasan por `completeJson`: la IA siempre responde un objeto JSON,
 * que se valida antes de devolverlo. Si la respuesta no es JSON o no pasa la validación, se le
 * pide a la IA que la corrija una vez.
 */

import { parseServiceAccount, serviceAccountTokenSource, type TokenSource } from "./google_auth.ts";

export type LlmProvider = "vertex" | "openai" | "foundry";

export interface LlmConfig {
  provider?: LlmProvider;
  /** Ruta base de la API compatible con OpenAI, sin /chat/completions al final. */
  baseUrl: string;
  /** API key (openai y foundry). Vertex usa `tokens`. */
  apiKey?: string;
  /** Tokens de acceso de Google (solo vertex). */
  tokens?: TokenSource;
  /** Modelo o deployment, ej. "google/gemini-3.5-flash". */
  model: string;
  /** Opcional: low, medium o high. Menos razonamiento responde más rápido. */
  reasoningEffort?: string;
  /** Opcional: límite de tokens de salida. */
  maxTokens?: number;
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
  readFile: (path: string) => Promise<string> = (p) => Deno.readTextFile(p),
): LlmConfig {
  const get = (k: string) => env(k)?.trim() || undefined;
  const provider = (get("LLM_PROVIDER") ?? inferProvider(get)) as LlmProvider;
  const common = {
    provider,
    // Generar una etapa completa con un modelo que razona puede tardar varios minutos.
    timeoutMs: Number(get("LLM_TIMEOUT_MS") ?? 300_000),
    maxRetries: 3,
    retryBaseMs: 1_000,
    reasoningEffort: get("LLM_REASONING_EFFORT"),
    maxTokens: get("LLM_MAX_TOKENS") ? Number(get("LLM_MAX_TOKENS")) : undefined,
  };

  if (provider === "vertex") {
    const project = get("GCP_PROJECT_ID");
    const credentials = get("GOOGLE_APPLICATION_CREDENTIALS");
    const missing = [!project && "GCP_PROJECT_ID", !credentials && "GOOGLE_APPLICATION_CREDENTIALS"]
      .filter(Boolean);
    if (missing.length) {
      throw new LlmError("config", `Faltan variables de entorno: ${missing.join(", ")}`);
    }
    const location = get("GCP_LOCATION") ?? "global";
    const host = location === "global"
      ? "https://aiplatform.googleapis.com"
      : `https://${location}-aiplatform.googleapis.com`;
    const model = get("LLM_MODEL") ?? "google/gemini-3.5-flash";
    let account: ReturnType<typeof parseServiceAccount> | null = null;
    return {
      ...common,
      baseUrl: get("LLM_BASE_URL")?.replace(/\/+$/, "") ??
        `${host}/v1/projects/${project}/locations/${location}/endpoints/openapi`,
      // Vertex nombra los modelos con su editor: "google/gemini-...".
      model: model.includes("/") ? model : `google/${model}`,
      tokens: serviceAccountTokenSource(async () => {
        if (account) return account;
        let text: string;
        try {
          text = await readFile(credentials!);
        } catch {
          throw new LlmError(
            "config",
            `No se encontró la clave de la cuenta de servicio en ${credentials}`,
          );
        }
        try {
          account = parseServiceAccount(text);
        } catch (e) {
          throw new LlmError("config", (e as Error).message);
        }
        return account;
      }),
    };
  }

  const baseUrl = get("LLM_BASE_URL")?.replace(/\/+$/, "");
  const apiKey = get("LLM_API_KEY");
  const model = get("LLM_MODEL");
  const missing = [
    !baseUrl && "LLM_BASE_URL",
    !apiKey && "LLM_API_KEY",
    !model && "LLM_MODEL",
  ].filter(Boolean);
  if (missing.length) {
    throw new LlmError("config", `Faltan variables de entorno: ${missing.join(", ")}`);
  }
  return { ...common, baseUrl: baseUrl!, apiKey: apiKey!, model: model! };
}

function inferProvider(get: (k: string) => string | undefined): LlmProvider {
  if (get("GCP_PROJECT_ID")) return "vertex";
  if (get("LLM_BASE_URL")?.includes(".azure.com")) return "foundry";
  return "openai";
}

/** Nombre legible del proveedor, para los mensajes de inicio. */
export function providerLabel(cfg: LlmConfig): string {
  return cfg.provider === "vertex"
    ? "Google Cloud Vertex AI"
    : cfg.provider === "openai"
    ? "API compatible con OpenAI"
    : "Microsoft Foundry";
}

async function authHeaders(cfg: LlmConfig, doFetch: typeof fetch): Promise<Record<string, string>> {
  if (cfg.tokens) {
    try {
      return { Authorization: `Bearer ${await cfg.tokens.token(doFetch)}` };
    } catch (e) {
      if (e instanceof LlmError) throw e;
      throw new LlmError("auth", (e as Error).message);
    }
  }
  if (cfg.provider === "openai") return { Authorization: `Bearer ${cfg.apiKey}` };
  return { "api-key": cfg.apiKey ?? "" };
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
  let jsonMode = true;
  const body = () =>
    JSON.stringify({
      model: cfg.model,
      messages,
      ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
      ...(temperature === undefined ? {} : { temperature }),
      ...(cfg.reasoningEffort ? { reasoning_effort: cfg.reasoningEffort } : {}),
      ...(cfg.maxTokens ? { max_tokens: cfg.maxTokens } : {}),
    });

  for (let retry = 0;; retry++) {
    // Fuera del try: un error de credenciales no debe confundirse con uno de red.
    const auth = await authHeaders(cfg, doFetch);
    let res: Response;
    try {
      res = await doFetch(`${cfg.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...auth },
        body: body(),
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
      const choice = data?.choices?.[0];
      const content = choice?.message?.content;
      if (choice?.finish_reason === "length") {
        throw new LlmError(
          "bad_response",
          "La respuesta de la IA se cortó por largo. Sube LLM_MAX_TOKENS o quítalo del .env.",
        );
      }
      if (typeof content !== "string" || !content.trim()) {
        throw new LlmError("bad_response", "La IA respondió sin contenido");
      }
      return content;
    }

    const detail = await res.text().catch(() => "");
    // Si el proveedor no acepta el modo JSON, se reintenta sin él: el prompt ya pide JSON.
    if (res.status === 400 && jsonMode && /response_format|json_object/i.test(detail)) {
      jsonMode = false;
      retry--;
      continue;
    }
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
      cfg.tokens?.reset();
      throw new LlmError(
        "auth",
        cfg.provider === "vertex"
          ? "Google Cloud rechazó el acceso: revisa que la API de Vertex AI esté habilitada y " +
            `que la cuenta de servicio tenga el rol "Vertex AI User" (${detail.slice(0, 200)})`
          : "La API key no es válida o no tiene acceso",
        res.status,
      );
    }
    if (res.status === 404) {
      throw new LlmError(
        "config",
        cfg.provider === "vertex"
          ? `No existe el modelo "${cfg.model}" en esa región, o GCP_PROJECT_ID es incorrecto`
          : `No existe el deployment "${cfg.model}" o LLM_BASE_URL es incorrecta`,
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
