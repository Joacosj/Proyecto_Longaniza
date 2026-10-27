import type { Context, MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Sql } from "../db/client.ts";
import { ApiError } from "../http/errors.ts";
import { sessionsRepo } from "../repositories/sessions.ts";
import type { PublicUser } from "../repositories/users.ts";
import { generateToken, hashToken } from "./tokens.ts";

export const SESSION_COOKIE = "ideator_session";
export const SESSION_TTL_DAYS = 30;

export interface AuthDeps {
  sql: Sql;
  sessionSecret: string;
  /** Agrega `Secure` a la cookie. Activo en producción (HTTPS). */
  secureCookies?: boolean;
}

/** Variables que `requireUser` deja en el contexto de Hono. */
export type AuthEnv = {
  Variables: {
    user: PublicUser;
    sessionId: string;
  };
};

/** Crea la sesión en la base y deja la cookie en la respuesta. */
export async function startSession(c: Context, deps: AuthDeps, userId: string) {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
  const repo = sessionsRepo(deps.sql);
  await repo.deleteExpiredFor(userId);
  await repo.create({ userId, tokenHash: await hashToken(token, deps.sessionSecret), expiresAt });
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "Lax",
    secure: deps.secureCookies ?? false,
    path: "/",
    expires: expiresAt,
  });
}

export function clearSessionCookie(c: Context, deps: AuthDeps) {
  deleteCookie(c, SESSION_COOKIE, { path: "/", secure: deps.secureCookies ?? false });
}

/** Exige una sesión válida. Deja `user` y `sessionId` en el contexto o responde 401. */
export function requireUser(deps: AuthDeps): MiddlewareHandler<AuthEnv> {
  return async (c, next) => {
    const token = getCookie(c, SESSION_COOKIE);
    if (!token) throw new ApiError("UNAUTHENTICATED", "Debes iniciar sesión");

    const session = await sessionsRepo(deps.sql).findValid(
      await hashToken(token, deps.sessionSecret),
    );
    if (!session) {
      clearSessionCookie(c, deps);
      throw new ApiError("UNAUTHENTICATED", "La sesión expiró o no es válida");
    }

    c.set("user", session.user);
    c.set("sessionId", session.sessionId);
    await next();
  };
}
