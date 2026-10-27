import { STAGE_ORDER, type StageKind } from "../contracts/artifacts.ts";
import type { Sql } from "../db/client.ts";
import type { ProjectRole } from "../auth/roles.ts";

export interface Project {
  id: string;
  name: string;
  initialIdea: string;
  createdBy: string;
  currentStage: StageKind;
  status: "in_progress" | "ready" | "generated";
  createdAt: Date;
  updatedAt: Date;
}

/** Proyecto visto por un usuario: incluye su rol. */
export interface ProjectForUser extends Project {
  role: ProjectRole;
}

const COLUMNS = (sql: Sql) =>
  sql`p.id, p.name, p.initial_idea AS "initialIdea", p.created_by AS "createdBy",
      p.current_stage AS "currentStage", p.status, p.created_at AS "createdAt",
      p.updated_at AS "updatedAt"`;

export function projectsRepo(sql: Sql) {
  return {
    /** Rol del usuario en el proyecto, o undefined si no es miembro (o no existe). */
    async roleOf(projectId: string, userId: string): Promise<ProjectRole | undefined> {
      const [row] = await sql<{ role: ProjectRole }[]>`
        SELECT role FROM project_members WHERE project_id = ${projectId} AND user_id = ${userId}`;
      return row?.role;
    },

    /** Solo los proyectos donde el usuario es miembro. */
    listForUser(userId: string): Promise<ProjectForUser[]> {
      return sql<ProjectForUser[]>`
        SELECT ${COLUMNS(sql)}, m.role
        FROM projects p JOIN project_members m ON m.project_id = p.id
        WHERE m.user_id = ${userId}
        ORDER BY p.updated_at DESC`;
    },

    async findForUser(projectId: string, userId: string): Promise<ProjectForUser | undefined> {
      const [row] = await sql<ProjectForUser[]>`
        SELECT ${COLUMNS(sql)}, m.role
        FROM projects p JOIN project_members m ON m.project_id = p.id
        WHERE p.id = ${projectId} AND m.user_id = ${userId}`;
      return row;
    },

    /**
     * Crea el proyecto, deja al creador como owner y crea las seis etapas
     * (la primera en curso, el resto bloqueadas). Debe llamarse dentro de una transacción.
     */
    async create(input: { name: string; initialIdea: string; userId: string }): Promise<Project> {
      const [project] = await sql<Project[]>`
        INSERT INTO projects (name, initial_idea, created_by)
        VALUES (${input.name}, ${input.initialIdea}, ${input.userId})
        RETURNING id, name, initial_idea AS "initialIdea", created_by AS "createdBy",
                  current_stage AS "currentStage", status, created_at AS "createdAt",
                  updated_at AS "updatedAt"`;

      await sql`
        INSERT INTO project_members (project_id, user_id, role, added_by)
        VALUES (${project.id}, ${input.userId}, 'owner', ${input.userId})`;

      const stages = STAGE_ORDER.map((kind, i) => ({
        project_id: project.id,
        kind,
        status: i === 0 ? "in_progress" : "locked",
        updated_by: input.userId,
      }));
      await sql`INSERT INTO stages ${sql(stages, "project_id", "kind", "status", "updated_by")}`;

      return project;
    },

    async update(
      projectId: string,
      changes: { name?: string; initialIdea?: string },
    ): Promise<Project> {
      const [row] = await sql<Project[]>`
        UPDATE projects SET
          name = COALESCE(${changes.name ?? null}, name),
          initial_idea = COALESCE(${changes.initialIdea ?? null}, initial_idea),
          updated_at = now()
        WHERE id = ${projectId}
        RETURNING id, name, initial_idea AS "initialIdea", created_by AS "createdBy",
                  current_stage AS "currentStage", status, created_at AS "createdAt",
                  updated_at AS "updatedAt"`;
      return row;
    },

    /** Borra el proyecto; miembros, etapas y demás se borran en cascada. */
    async delete(projectId: string): Promise<{ name: string } | undefined> {
      const [row] = await sql<{ name: string }[]>`
        DELETE FROM projects WHERE id = ${projectId} RETURNING name`;
      return row;
    },
  };
}
