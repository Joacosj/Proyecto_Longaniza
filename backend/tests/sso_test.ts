import assert from "node:assert/strict";
import {
  googleProvider,
  pkceChallenge,
  type SsoClaims,
  SsoError,
  type SsoProvider,
} from "../src/auth/sso.ts";
import { buildApp, TestClient } from "./helpers/app.ts";
import { createTestDb } from "./helpers/db.ts";

const APP_URL = "http://app.test";

/** Proveedor falso: entrega la identidad que la prueba prepare y registra lo que recibe. */
function fakeProvider() {
  const state = {
    next: null as SsoClaims | null,
    fail: false,
    lastExchange: null as null | {
      code: string;
      codeVerifier: string;
      nonce: string;
      redirectUri: string;
    },
    lastAuth: null as null | {
      state: string;
      nonce: string;
      codeChallenge: string;
      redirectUri: string;
    },
  };
  const provider: SsoProvider = {
    name: "google",
    authorizationUrl(input) {
      state.lastAuth = input;
      const u = new URL("https://idp.test/auth");
      u.searchParams.set("state", input.state);
      u.searchParams.set("redirect_uri", input.redirectUri);
      return u.toString();
    },
    exchange(input) {
      state.lastExchange = input;
      if (state.fail || !state.next) return Promise.reject(new SsoError("rechazado"));
      return Promise.resolve(state.next);
    },
  };
  return { provider, state };
}

Deno.test("A7: SSO con Google", async (t) => {
  const db = await createTestDb();
  const fake = fakeProvider();
  const app = buildApp({ sql: db.sql, sso: { google: fake.provider }, appUrl: APP_URL });

  /** Recorre el flujo como un navegador: start → proveedor → callback. */
  async function ssoLogin(client: TestClient, claims: SsoClaims, next?: string) {
    const start = await client.get(
      `/api/auth/sso/google/start${next ? `?next=${encodeURIComponent(next)}` : ""}`,
    );
    assert.equal(start.status, 302);
    const state = new URL(start.headers.get("location")!).searchParams.get("state")!;
    fake.state.next = claims;
    return client.get(`/api/auth/sso/google/callback?code=abc&state=${state}`);
  }

  const claims = (over: Partial<SsoClaims> = {}): SsoClaims => ({
    subject: "google-sub-1",
    email: "nueva@example.com",
    emailVerified: true,
    name: "Nueva Persona",
    ...over,
  });

  try {
    await t.step("GET /providers lista los activos; sin configurar, ninguno", async () => {
      const res = await new TestClient(app).get("/api/auth/sso/providers");
      assert.deepEqual(await res.json(), { providers: ["google"] });
      const off = buildApp({ sql: db.sql });
      const r2 = await new TestClient(off).get("/api/auth/sso/providers");
      assert.deepEqual(await r2.json(), { providers: [] });
      assert.equal((await new TestClient(off).get("/api/auth/sso/google/start")).status, 404);
    });

    await t.step("un proveedor desconocido responde 404", async () => {
      assert.equal((await new TestClient(app).get("/api/auth/sso/github/start")).status, 404);
    });

    await t.step("start redirige al proveedor con state, PKCE y una cookie firmada", async () => {
      const c = new TestClient(app);
      const res = await c.get("/api/auth/sso/google/start");
      assert.equal(res.status, 302);
      assert.match(res.headers.get("location")!, /^https:\/\/idp\.test\/auth\?/);
      const auth = fake.state.lastAuth!;
      assert.equal(auth.redirectUri, `${APP_URL}/api/auth/sso/google/callback`);
      assert.ok(auth.state.length >= 40 && auth.nonce.length >= 40);
      assert.ok(auth.codeChallenge.length >= 40);

      const cookie = res.headers.getSetCookie().find((h) => h.startsWith("ideator_sso="))!;
      assert.match(cookie, /HttpOnly/i);
      assert.match(cookie, /SameSite=Lax/i);
      assert.match(cookie, /Path=\/api\/auth\/sso/i);
      assert.ok(!cookie.includes(auth.state), "el state no viaja en claro en la cookie");
    });

    await t.step("primer ingreso: crea el usuario sin contraseña y abre sesión", async () => {
      const c = new TestClient(app);
      const res = await ssoLogin(c, claims());
      assert.equal(res.status, 302);
      assert.equal(res.headers.get("location"), `${APP_URL}/#/proyectos`);
      assert.ok(c.cookie, "debe dejar la cookie de sesión");
      assert.equal(c.extra.has("ideator_sso"), false, "la cookie del flujo se borra");

      const me = await (await c.get("/api/auth/me")).json();
      assert.equal(me.user.email, "nueva@example.com");
      assert.equal(me.user.name, "Nueva Persona");

      const [u] = await db.sql`SELECT password_hash FROM users WHERE email = 'nueva@example.com'`;
      assert.equal(u.password_hash, null);
      const ids = await db.sql`SELECT provider, subject FROM user_identities`;
      assert.deepEqual(ids.map((i) => [i.provider, i.subject]), [["google", "google-sub-1"]]);

      // El backend recibió el verificador PKCE que corresponde al desafío enviado.
      const ex = fake.state.lastExchange!;
      assert.equal(await pkceChallenge(ex.codeVerifier), fake.state.lastAuth!.codeChallenge);
      assert.equal(ex.nonce, fake.state.lastAuth!.nonce);
    });

    await t.step("el mismo sujeto vuelve a la misma cuenta aunque cambie su correo", async () => {
      const c = new TestClient(app);
      await ssoLogin(c, claims({ email: "otro-correo@example.com" }));
      const me = await (await c.get("/api/auth/me")).json();
      assert.equal(me.user.email, "nueva@example.com");
      const [{ n }] = await db.sql`SELECT count(*)::int AS n FROM users`;
      assert.equal(n, 1);
    });

    await t.step("si el correo ya existe, enlaza la identidad a esa cuenta", async () => {
      const local = new TestClient(app);
      const ana = await local.register("ana@example.com", "Ana", "clave-de-ana-123");

      const c = new TestClient(app);
      await ssoLogin(c, claims({ subject: "google-ana", email: "ANA@example.com", name: "Ana G" }));
      const me = await (await c.get("/api/auth/me")).json();
      assert.equal(me.user.id, ana.id);
      assert.equal(me.user.name, "Ana", "no cambia el nombre de la cuenta existente");

      const [link] = await db.sql`
        SELECT user_id FROM user_identities WHERE subject = 'google-ana'`;
      assert.equal(link.user_id, ana.id);

      // Y su contraseña sigue funcionando.
      const login = await new TestClient(app).post("/api/auth/login", {
        email: "ana@example.com",
        password: "clave-de-ana-123",
      });
      assert.equal(login.status, 200);
    });

    await t.step("un correo no verificado no toma una cuenta existente", async () => {
      await new TestClient(app).register("beto@example.com", "Beto");
      const c = new TestClient(app);
      const res = await ssoLogin(
        c,
        claims({ subject: "intruso", email: "beto@example.com", emailVerified: false }),
      );
      assert.equal(res.status, 302);
      assert.equal(
        res.headers.get("location"),
        `${APP_URL}/#/login?error=sso_correo_no_verificado`,
      );
      assert.equal(c.cookie, "");
      const links = await db.sql`SELECT 1 FROM user_identities WHERE subject = 'intruso'`;
      assert.equal(links.length, 0);
    });

    await t.step("vuelve a la ruta pedida en next, solo si es interna", async () => {
      const c = new TestClient(app);
      const res = await ssoLogin(c, claims(), "#/invitaciones/abc");
      assert.equal(res.headers.get("location"), `${APP_URL}/#/invitaciones/abc`);

      const evil = await ssoLogin(new TestClient(app), claims(), "https://malo.test");
      assert.equal(evil.headers.get("location"), `${APP_URL}/#/proyectos`);
    });

    await t.step("callback sin la cookie del flujo o con otro state responde 400", async () => {
      const noCookie = await new TestClient(app).get(
        "/api/auth/sso/google/callback?code=abc&state=xyz",
      );
      assert.equal(noCookie.status, 400);

      const c = new TestClient(app);
      await c.get("/api/auth/sso/google/start");
      const wrong = await c.get("/api/auth/sso/google/callback?code=abc&state=otro");
      assert.equal(wrong.status, 400);
    });

    await t.step("una cookie del flujo alterada responde 400", async () => {
      const c = new TestClient(app);
      const start = await c.get("/api/auth/sso/google/start");
      const state = new URL(start.headers.get("location")!).searchParams.get("state")!;
      const [payload, sig] = c.extra.get("ideator_sso")!.split(".");
      c.extra.set("ideator_sso", `${payload}x.${sig}`);
      const res = await c.get(`/api/auth/sso/google/callback?code=abc&state=${state}`);
      assert.equal(res.status, 400);
    });

    await t.step(
      "si el usuario cancela o el proveedor falla, vuelve al login con error",
      async () => {
        const c = new TestClient(app);
        const start = await c.get("/api/auth/sso/google/start");
        const state = new URL(start.headers.get("location")!).searchParams.get("state")!;
        const cancel = await c.get(
          `/api/auth/sso/google/callback?error=access_denied&state=${state}`,
        );
        assert.equal(cancel.headers.get("location"), `${APP_URL}/#/login?error=sso_cancelado`);

        fake.state.fail = true;
        const res = await ssoLogin(new TestClient(app), claims());
        fake.state.fail = false;
        assert.equal(res.headers.get("location"), `${APP_URL}/#/login?error=sso_fallo`);
      },
    );
  } finally {
    await db.close();
  }
});

// ------------------------------------------------------------------ proveedor de Google

function jwt(payload: Record<string, unknown>): string {
  const enc = (o: unknown) =>
    btoa(JSON.stringify(o)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
  return `${enc({ alg: "RS256" })}.${enc(payload)}.firma`;
}

function googleWith(payload: Record<string, unknown>, status = 200) {
  const calls: { url: string; body: URLSearchParams }[] = [];
  const fetchFn = ((url: string, init: RequestInit) => {
    calls.push({ url, body: init.body as URLSearchParams });
    return Promise.resolve(
      new Response(JSON.stringify({ id_token: jwt(payload) }), { status }),
    );
  }) as typeof fetch;
  return { provider: googleProvider({ clientId: "cid", clientSecret: "secreto" }, fetchFn), calls };
}

const valid = {
  iss: "https://accounts.google.com",
  aud: "cid",
  exp: Math.floor(Date.now() / 1000) + 300,
  nonce: "n1",
  sub: "123",
  email: "Persona@Gmail.com",
  email_verified: true,
  name: "Persona",
};
const exchange = (p: SsoProvider) =>
  p.exchange({ code: "c", codeVerifier: "v", redirectUri: "http://x/cb", nonce: "n1" });

Deno.test("googleProvider arma la URL de autorización con PKCE", () => {
  const { provider } = googleWith(valid);
  const url = new URL(provider.authorizationUrl({
    state: "s",
    nonce: "n",
    codeChallenge: "cc",
    redirectUri: "http://x/cb",
  }));
  assert.equal(url.origin + url.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
  const q = Object.fromEntries(url.searchParams);
  assert.equal(q.client_id, "cid");
  assert.equal(q.response_type, "code");
  assert.equal(q.scope, "openid email profile");
  assert.equal(q.code_challenge_method, "S256");
  assert.equal(q.state, "s");
  assert.equal(q.nonce, "n");
});

Deno.test("googleProvider cambia el código y valida el id_token", async () => {
  const { provider, calls } = googleWith(valid);
  const out = await exchange(provider);
  assert.deepEqual(out, {
    subject: "123",
    email: "persona@gmail.com",
    emailVerified: true,
    name: "Persona",
  });
  assert.equal(calls[0].url, "https://oauth2.googleapis.com/token");
  assert.equal(calls[0].body.get("grant_type"), "authorization_code");
  assert.equal(calls[0].body.get("code_verifier"), "v");
  assert.equal(calls[0].body.get("client_secret"), "secreto");
});

Deno.test("googleProvider rechaza tokens con emisor, destinatario, vencimiento o nonce inválidos", async () => {
  for (
    const bad of [
      { iss: "https://malo.test" },
      { aud: "otra-app" },
      { exp: Math.floor(Date.now() / 1000) - 10 },
      { nonce: "otro" },
      { sub: "" },
    ]
  ) {
    await assert.rejects(exchange(googleWith({ ...valid, ...bad }).provider), SsoError);
  }
  await assert.rejects(exchange(googleWith(valid, 400).provider), SsoError);
});
