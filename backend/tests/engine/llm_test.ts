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

Deno.test("foundry: envía la petición con el encabezado api-key y devuelve el JSON validado", async () => {
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

Deno.test("si las correcciones también fallan, lanza bad_response", async () => {
  const { fn } = fakeFetch([ok("no es json"), ok("tampoco"), ok("menos")]);
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

// ------------------------------------------------------------------ Google Cloud y otros proveedores

async function testServiceAccount(): Promise<string> {
  const pair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  const der = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
  const pem = `-----BEGIN PRIVATE KEY-----\n${
    btoa(String.fromCharCode(...der))
  }\n-----END PRIVATE KEY-----\n`;
  return JSON.stringify({
    type: "service_account",
    client_email: "ideator@proyecto.iam.gserviceaccount.com",
    private_key: pem,
    token_uri: "https://oauth2.googleapis.com/token",
  });
}

Deno.test("vertex: arma la URL del proyecto y antepone google/ al modelo", () => {
  const env: Record<string, string> = {
    GCP_PROJECT_ID: "ideator-123",
    GOOGLE_APPLICATION_CREDENTIALS: "../secrets/gcp-key.json",
    LLM_MODEL: "gemini-3.5-flash",
  };
  const c = loadLlmConfig((k) => env[k]);
  assert.equal(c.provider, "vertex");
  assert.equal(
    c.baseUrl,
    "https://aiplatform.googleapis.com/v1/projects/ideator-123/locations/global/endpoints/openapi",
  );
  assert.equal(c.model, "google/gemini-3.5-flash");

  env.GCP_LOCATION = "us-central1";
  assert.match(loadLlmConfig((k) => env[k]).baseUrl, /^https:\/\/us-central1-aiplatform/);
});

Deno.test("vertex: lista las variables que faltan", () => {
  assert.throws(
    () => loadLlmConfig((k) => ({ LLM_PROVIDER: "vertex" } as Record<string, string>)[k]),
    (e: unknown) =>
      e instanceof LlmError && /GCP_PROJECT_ID, GOOGLE_APPLICATION_CREDENTIALS/.test(e.message),
  );
});

Deno.test("vertex: pide un token con la cuenta de servicio, lo usa y lo reutiliza", async () => {
  const keyJson = await testServiceAccount();
  const env: Record<string, string> = {
    GCP_PROJECT_ID: "ideator-123",
    GOOGLE_APPLICATION_CREDENTIALS: "clave.json",
  };
  const c = { ...loadLlmConfig((k) => env[k], () => Promise.resolve(keyJson)), retryBaseMs: 1 };
  const token = new Response(
    JSON.stringify({ access_token: "ya29.token", expires_in: 3600 }),
    { status: 200 },
  );
  const { fn, calls } = fakeFetch([token, ok('{"ok": true}'), ok('{"ok": true}')]);
  const opts = { system: "", messages: [], validate: validateOk, fetchFn: fn };
  await completeJson(c, opts);
  await completeJson(c, opts);

  assert.equal(calls.length, 3, "un token y dos respuestas: el token se reutiliza");
  assert.equal(calls[0].url, "https://oauth2.googleapis.com/token");
  const form = new URLSearchParams(calls[0].init.body as URLSearchParams);
  assert.equal(form.get("grant_type"), "urn:ietf:params:oauth:grant-type:jwt-bearer");
  const [, payload] = form.get("assertion")!.split(".");
  const claims = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
  assert.equal(claims.iss, "ideator@proyecto.iam.gserviceaccount.com");
  assert.equal(claims.scope, "https://www.googleapis.com/auth/cloud-platform");

  assert.match(calls[1].url, /endpoints\/openapi\/chat\/completions$/);
  const headers = calls[1].init.headers as Record<string, string>;
  assert.equal(headers.Authorization, "Bearer ya29.token");
  assert.equal(headers["api-key"], undefined);
  assert.equal(JSON.parse(calls[1].init.body as string).model, "google/gemini-3.5-flash");
});

Deno.test("vertex: si falta el archivo de la clave, lo dice", async () => {
  const env: Record<string, string> = {
    GCP_PROJECT_ID: "p",
    GOOGLE_APPLICATION_CREDENTIALS: "../secrets/gcp-key.json",
  };
  const c = loadLlmConfig((k) => env[k], () => Promise.reject(new Error("ENOENT")));
  const { fn } = fakeFetch([]);
  await assert.rejects(
    completeJson(c, { system: "", messages: [], validate: validateOk, fetchFn: fn }),
    (e: unknown) =>
      e instanceof LlmError && e.kind === "config" && /secrets\/gcp-key/.test(e.message),
  );
});

Deno.test("openai: usa Authorization Bearer con la API key", async () => {
  const env: Record<string, string> = {
    LLM_BASE_URL: "https://generativelanguage.googleapis.com/v1beta/openai/",
    LLM_API_KEY: "clave",
    LLM_MODEL: "gemini-3.5-flash",
  };
  const c = loadLlmConfig((k) => env[k]);
  assert.equal(c.provider, "openai");
  const { fn, calls } = fakeFetch([ok('{"ok": true}')]);
  await completeJson(c, { system: "", messages: [], validate: validateOk, fetchFn: fn });
  assert.equal(
    calls[0].url,
    "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
  );
  assert.equal((calls[0].init.headers as Record<string, string>).Authorization, "Bearer clave");
});

Deno.test("si el proveedor rechaza el modo JSON, reintenta sin él", async () => {
  const { fn, calls } = fakeFetch([
    new Response('{"error":"Invalid value for response_format"}', { status: 400 }),
    ok('{"ok": true}'),
  ]);
  await completeJson(cfg, { system: "", messages: [], validate: validateOk, fetchFn: fn });
  assert.equal(JSON.parse(calls[0].init.body as string).response_format.type, "json_object");
  assert.equal(JSON.parse(calls[1].init.body as string).response_format, undefined);
});

Deno.test("una respuesta cortada por largo da un error claro", async () => {
  const cut = new Response(
    JSON.stringify({ choices: [{ finish_reason: "length", message: { content: '{"ok":' } }] }),
    { status: 200 },
  );
  const { fn } = fakeFetch([cut]);
  await assert.rejects(
    completeJson(cfg, { system: "", messages: [], validate: validateOk, fetchFn: fn }),
    (e: unknown) => e instanceof LlmError && /LLM_MAX_TOKENS/.test(e.message),
  );
});
