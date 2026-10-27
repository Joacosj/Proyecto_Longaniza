import { Hono } from "hono";
import {
  getDummyHash,
  hashPassword,
  MAX_PASSWORD_BYTES,
  verifyPassword,
} from "../auth/password.ts";
import {
  type AuthDeps,
  type AuthEnv,
  clearSessionCookie,
  requireUser,
  startSession,
} from "../auth/session.ts";
import { EMAIL_PATTERN, readJsonObject, Validator } from "../http/body.ts";
import { ApiError } from "../http/errors.ts";
import { sessionsRepo } from "../repositories/sessions.ts";
import { EmailTakenError, usersRepo } from "../repositories/users.ts";

export const MIN_PASSWORD_LENGTH = 8;

export function authRoutes(deps: AuthDeps) {
  const r = new Hono<AuthEnv>();
  const users = usersRepo(deps.sql);

  r.post("/register", async (c) => {
    const v = new Validator(await readJsonObject(c));
    const email = v.string("email", {
      max: 254,
      pattern: EMAIL_PATTERN,
      patternMsg: "Correo inválido",
    });
    const name = v.string("name", { min: 1, max: 100 });
    const password = v.string("password", { min: MIN_PASSWORD_LENGTH, trim: false });
    if (new TextEncoder().encode(password).length > MAX_PASSWORD_BYTES) {
      v.fail("password", `Máximo ${MAX_PASSWORD_BYTES} bytes`);
    }
    v.done();

    let user;
    try {
      user = await users.create({
        email: email.toLowerCase(),
        name,
        passwordHash: await hashPassword(password),
      });
    } catch (err) {
      if (err instanceof EmailTakenError) {
        throw new ApiError("CONFLICT", "Ya existe una cuenta con ese correo");
      }
      throw err;
    }

    await startSession(c, deps, user.id);
    return c.json({ user }, 201);
  });

  r.post("/login", async (c) => {
    const v = new Validator(await readJsonObject(c));
    const email = v.string("email", { min: 1, max: 254 });
    const password = v.string("password", { min: 1, trim: false });
    v.done();

    const found = await users.findByEmail(email);
    // Siempre se compara contra un hash, exista o no el usuario, para no revelar
    // por tiempo de respuesta qué correos están registrados.
    const ok = await verifyPassword(password, found?.passwordHash ?? await getDummyHash());
    if (!found || !found.passwordHash || !ok) {
      throw new ApiError("UNAUTHENTICATED", "Correo o contraseña incorrectos");
    }

    await startSession(c, deps, found.id);
    return c.json({ user: { id: found.id, email: found.email, name: found.name } });
  });

  r.post("/logout", requireUser(deps), async (c) => {
    await sessionsRepo(deps.sql).delete(c.get("sessionId"));
    clearSessionCookie(c, deps);
    return c.body(null, 204);
  });

  r.get("/me", requireUser(deps), (c) => c.json({ user: c.get("user") }));

  return r;
}
