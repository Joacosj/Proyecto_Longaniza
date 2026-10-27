import assert from "node:assert/strict";
import { hashToken } from "../src/auth/tokens.ts";
import { buildApp, TEST_SECRET, TestClient } from "./helpers/app.ts";
import { createTestDb } from "./helpers/db.ts";

Deno.test("A1: registro, login y sesiones", async (t) => {
  const db = await createTestDb();
  const app = buildApp({ sql: db.sql });
  const client = () => new TestClient(app);

  try {
    await t.step("registro crea la cuenta, deja sesión y responde 201", async () => {
      const c = client();
      const res = await c.post("/api/auth/register", {
        email: "Ana@Example.com",
        name: "Ana",
        password: "contraseña-segura",
      });
      assert.equal(res.status, 201);
      const { user } = await res.json();
      assert.equal(user.email, "ana@example.com");
      assert.equal(user.name, "Ana");
      assert.equal(user.passwordHash, undefined);

      const cookie = res.headers.getSetCookie().find((h) => h.startsWith("ideator_session="));
      assert.ok(cookie, "debe dejar la cookie de sesión");
      assert.match(cookie, /HttpOnly/i);
      assert.match(cookie, /SameSite=Lax/i);
      assert.match(cookie, /Path=\//i);

      const me = await c.get("/api/auth/me");
      assert.equal(me.status, 200);
      assert.equal((await me.json()).user.id, user.id);
    });

    await t.step(
      "la base guarda el hash del token y de la contraseña, no los valores",
      async () => {
        const c = client();
        await c.register("hash@example.com", "Hash", "mi-clave-secreta");
        const token = c.cookie.split("=")[1];

        const [user] = await db
          .sql`SELECT password_hash FROM users WHERE email = 'hash@example.com'`;
        assert.notEqual(user.password_hash, "mi-clave-secreta");
        assert.match(user.password_hash, /^\$2[aby]\$/);

        const sessions = await db.sql`SELECT token_hash FROM sessions WHERE token_hash = ${token}`;
        assert.equal(sessions.length, 0, "el token no debe guardarse en claro");
        const hashed = await db.sql`
        SELECT 1 FROM sessions WHERE token_hash = ${await hashToken(token, TEST_SECRET)}`;
        assert.equal(hashed.length, 1);
      },
    );

    await t.step("registro duplicado responde 409, sin importar mayúsculas", async () => {
      const res = await client().post("/api/auth/register", {
        email: "ANA@example.com",
        name: "Otra Ana",
        password: "otra-contraseña",
      });
      assert.equal(res.status, 409);
      assert.equal((await res.json()).error.code, "CONFLICT");
    });

    await t.step("registro con datos inválidos responde 422 con los campos", async () => {
      const res = await client().post("/api/auth/register", {
        email: "no-es-correo",
        name: "  ",
        password: "corta",
      });
      assert.equal(res.status, 422);
      const body = await res.json();
      assert.equal(body.error.code, "VALIDATION_ERROR");
      assert.deepEqual(Object.keys(body.error.details.fields).sort(), [
        "email",
        "name",
        "password",
      ]);
    });

    await t.step("JSON mal formado responde 400", async () => {
      const res = await app.request("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{ no es json",
      });
      assert.equal(res.status, 400);
      assert.equal((await res.json()).error.code, "BAD_REQUEST");
    });

    await t.step("login correcto responde 200 y deja sesión", async () => {
      const c = client();
      const res = await c.post("/api/auth/login", {
        email: "ana@EXAMPLE.com",
        password: "contraseña-segura",
      });
      assert.equal(res.status, 200);
      assert.equal((await res.json()).user.name, "Ana");
      assert.equal((await c.get("/api/auth/me")).status, 200);
    });

    await t.step("login con contraseña incorrecta responde 401", async () => {
      const c = client();
      const res = await c.post("/api/auth/login", {
        email: "ana@example.com",
        password: "incorrecta",
      });
      assert.equal(res.status, 401);
      assert.equal((await res.json()).error.code, "UNAUTHENTICATED");
      assert.equal(c.cookie, "");
    });

    await t.step("login con correo inexistente responde 401 con el mismo mensaje", async () => {
      const wrongPass = await client().post("/api/auth/login", {
        email: "ana@example.com",
        password: "incorrecta",
      });
      const noUser = await client().post("/api/auth/login", {
        email: "nadie@example.com",
        password: "incorrecta",
      });
      assert.equal(noUser.status, 401);
      assert.equal((await noUser.json()).error.message, (await wrongPass.json()).error.message);
    });

    await t.step("login de una cuenta solo SSO (sin contraseña) responde 401", async () => {
      await db.sql`INSERT INTO users (email, name) VALUES ('sso@example.com', 'SSO')`;
      const res = await client().post("/api/auth/login", {
        email: "sso@example.com",
        password: "cualquier-cosa",
      });
      assert.equal(res.status, 401);
    });

    await t.step("login sin campos responde 422", async () => {
      const res = await client().post("/api/auth/login", {});
      assert.equal(res.status, 422);
    });

    await t.step("/me sin cookie responde 401", async () => {
      const res = await client().get("/api/auth/me");
      assert.equal(res.status, 401);
      assert.equal((await res.json()).error.code, "UNAUTHENTICATED");
    });

    await t.step("/me con una cookie inventada responde 401", async () => {
      const c = client();
      c.cookie = "ideator_session=token-inventado";
      assert.equal((await c.get("/api/auth/me")).status, 401);
    });

    await t.step("una sesión vencida responde 401", async () => {
      const c = client();
      const user = await c.register("vence@example.com");
      await db.sql`UPDATE sessions SET expires_at = now() - interval '1 minute'
                   WHERE user_id = ${user.id}`;
      assert.equal((await c.get("/api/auth/me")).status, 401);
    });

    await t.step("logout borra la sesión: la cookie anterior deja de servir", async () => {
      const c = client();
      await c.register("logout@example.com");
      const oldCookie = c.cookie;

      const res = await c.post("/api/auth/logout");
      assert.equal(res.status, 204);
      assert.equal(c.cookie, "", "debe pedir al navegador borrar la cookie");

      const reused = client();
      reused.cookie = oldCookie;
      assert.equal((await reused.get("/api/auth/me")).status, 401);
    });

    await t.step("logout sin sesión responde 401", async () => {
      assert.equal((await client().post("/api/auth/logout")).status, 401);
    });
  } finally {
    await db.close();
  }
});
