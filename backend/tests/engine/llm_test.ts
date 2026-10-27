import assert from "node:assert/strict";
import { completeJson, type LlmConfig, LlmError, loadLlmConfig } from "../../src/engine/llm.ts";

const cfg: LlmConfig = {
  baseUrl: "https://ejemplo.openai.azure.com/openai/v1",
  apiKey: "test-key",
  model: "gpt-6.1-sol",
  timeoutMs: 1_000,
  maxRetries: 2,
  retryBaseMs: 1,
};

type Call = { url: string; init: RequestInit };

/** fetch falso que devuelve las respuestas en orden y registra las llamadas. */
function fakeFetch(responses: Response[]) {
  const calls: Call[] = [];
  const fn = ((url: string, init: RequestInit) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (!next) throw new Error("sin más respuestas");
    return Promise.resolve(next);
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const ok = (content: string) =>
  new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });

const validateOk = (v: unknown) => {
  if ((v as { ok?: unknown })?.ok !== true) throw new Error("falta ok: true");
  return v as { ok: true };
};

Deno.test("envía la petición en el formato de Foundry y devuelve el JSON validado", async () => {
  const { fn, calls } = fakeFetch([ok('{"ok": true}')]);
  const result = await completeJson(cfg, {
    system: "sistema",
    messages: [{ role: "user", content: "hola" }],
    validate: validateOk,
    fetchFn: fn,
  });

  assert.deepEqual(result, { ok: true });
  assert.equal(calls[0].url, `${cfg.baseUrl}/chat/completions`);
  assert.equal((calls[0].init.headers as Record<string, string>)["api-key"], "test-key");
  const body = JSON.parse(calls[0].init.body as string);
  assert.equal(body.model, "gpt-6.1-sol");
  assert.deepEqual(body.response_format, { type: "json_object" });
  assert.equal(body.messages[0].role, "system");
  assert.equal(body.messages[1].content, "hola");
});

Deno.test("acepta JSON envuelto en un bloque de código", async () => {
  const { fn } = fakeFetch([ok('```json\n{"ok": true}\n```')]);
  const result = await completeJson(cfg, {
    system: "",
    messages: [],
    validate: validateOk,
    fetchFn: fn,
  });
  assert.deepEqual(result, { ok: true });
});

Deno.test("si la respuesta no es válida, pide una corrección y la usa", async () => {
  const { fn, calls } = fakeFetch([ok('{"ok": false}'), ok('{"ok": true}')]);
  const result = await completeJson(cfg, {
    system: "",
    messages: [],
    validate: validateOk,
    fetchFn: fn,
  });
  assert.deepEqual(result, { ok: true });
  assert.equal(calls.length, 2);
  const retryMessages = JSON.parse(calls[1].init.body as string).messages;
  assert.match(retryMessages.at(-1).content, /falta ok: true/);
});

Deno.test("si la corrección también falla, lanza bad_response", async () => {
  const { fn } = fakeFetch([ok("no es json"), ok("tampoco")]);
  await assert.rejects(
    completeJson(cfg, { system: "", messages: [], validate: validateOk, fetchFn: fn }),
    (e) => e instanceof LlmError && e.kind === "bad_response",
  );
});

Deno.test("reintenta ante 429 y luego responde", async () => {
  const { fn, calls } = fakeFetch([new Response("lento", { status: 429 }), ok('{"ok": true}')]);
  const result = await completeJson(cfg, {
    system: "",
    messages: [],
    validate: validateOk,
    fetchFn: fn,
  });
  assert.deepEqual(result, { ok: true });
  assert.equal(calls.length, 2);
});

Deno.test("ante 401 no reintenta y lanza un error de autenticación", async () => {
  const { fn, calls } = fakeFetch([new Response("no", { status: 401 })]);
  await assert.rejects(
    completeJson(cfg, { system: "", messages: [], validate: validateOk, fetchFn: fn }),
    (e) => e instanceof LlmError && e.kind === "auth",
  );
  assert.equal(calls.length, 1);
});

Deno.test("ante 404 indica que el deployment o la URL están mal", async () => {
  const { fn } = fakeFetch([new Response("no", { status: 404 })]);
  await assert.rejects(
    completeJson(cfg, { system: "", messages: [], validate: validateOk, fetchFn: fn }),
    (e) => e instanceof LlmError && e.kind === "config" && e.message.includes("gpt-6.1-sol"),
  );
});

Deno.test("loadLlmConfig lista las variables que faltan", () => {
  assert.throws(
    () => loadLlmConfig(() => undefined),
    (e) => e instanceof LlmError && /LLM_BASE_URL, LLM_API_KEY, LLM_MODEL/.test(e.message),
  );
});

Deno.test("loadLlmConfig quita la barra final de la URL", () => {
  const env: Record<string, string> = {
    LLM_BASE_URL: "https://x.openai.azure.com/openai/v1/",
    LLM_API_KEY: "k",
    LLM_MODEL: "m",
  };
  assert.equal(loadLlmConfig((k) => env[k]).baseUrl, "https://x.openai.azure.com/openai/v1");
});
