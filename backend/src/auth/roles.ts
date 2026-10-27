import type { MiddlewareHandler } from "hono";
import type { Sql } from "../db/client.ts";
import { ApiError } from "../http/errors.ts";
import type { PublicUser } from "../repositories/users.ts";
import { projectsRepo } from "../repositories/projects.ts";

export type ProjectRole = "owner" | "editor" | "viewer";

const RANK: Record<ProjectRole, number> = { viewer: 1, editor: 2, owner: 3 };

/** Jerarquía owner > editor > viewer. */
export function roleAtLeast(role: ProjectRole, min: ProjectRole): boolean {
  return RANK[role] >= RANK[min];
}

export function isProjectRole(value: unknown): value is ProjectRole {
  return value === "owner" || value === "editor" || value === "viewer";
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID.test(value);
}

/** Variables de contexto en rutas de proyecto (además de las de `requireUser`). */
export type ProjectEnv = {
  Variables: {
    user: PublicUser;
    sessionId: string;
    projectId: string;
    projectRole: ProjectRole;
  };
};

/**
 * Exige que el usuario (ya autenticado con `requireUser`) sea miembro del proyecto `:id`
 * con al menos el rol indicado. Si no es miembro, o el proyecto no existe, responde 403:
 * conocer un id no da acceso ni revela si existe.
 */
export function requireProjectRole(
  deps: { sql: Sql },
  min: ProjectRole,
): MiddlewareHandler<ProjectEnv> {
  return async (c, next) => {
    const projectId = c.req.param("id") ?? "";
    if (!isUuid(projectId)) {
      throw new ApiError("BAD_REQUEST", "Identificador de proyecto inválido");
    }

    const role = await projectsRepo(deps.sql).roleOf(projectId, c.get("user").id);
    if (!role) throw new ApiError("FORBIDDEN", "No tienes acceso a este proyecto");
    if (!roleAtLeast(role, min)) {
      throw new ApiError("FORBIDDEN", "Tu rol en este proyecto no permite esta acción");
    }

    c.set("projectId", projectId);
    c.set("projectRole", role);
    await next();
  };
}
