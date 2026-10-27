import type { Sql } from "../db/client.ts";

export interface AuditEntry {
  /** NULL para acciones que sobreviven al proyecto (ej. su eliminación). */
  projectId: string | null;
  userId: string | null;
  /** Formato `entidad.verbo`: 'project.created', 'stage.updated', 'member.removed'... */
  action: string;
  entityType: string;
  entityId?: string | null;
  detail?: Record<string, unknown>;
}

export interface AuditRow {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  detail: Record<string, unknown>;
  createdAt: Date;
  user: { id: string; name: string } | null;
}

export function auditRepo(sql: Sql) {
  return {
    async log(e: AuditEntry) {
      await sql`
        INSERT INTO audit_log (project_id, user_id, action, entity_type, entity_id, detail)
        VALUES (${e.projectId}, ${e.userId}, ${e.action}, ${e.entityType},
                ${e.entityId ?? null}, ${sql.json((e.detail ?? {}) as never)})`;
    },

    async listForProject(projectId: string, limit = 100): Promise<AuditRow[]> {
      const rows = await sql<
        (Omit<AuditRow, "user"> & { userId: string | null; userName: string | null })[]
      >`
        SELECT a.id::text, a.action, a.entity_type AS "entityType", a.entity_id AS "entityId",
               a.detail, a.created_at AS "createdAt", u.id AS "userId", u.name AS "userName"
        FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
        WHERE a.project_id = ${projectId}
        ORDER BY a.created_at DESC, a.id DESC
        LIMIT ${limit}`;
      return rows.map(({ userId, userName, ...r }) => ({
        ...r,
        user: userId ? { id: userId, name: userName ?? "" } : null,
      }));
    },
  };
}
