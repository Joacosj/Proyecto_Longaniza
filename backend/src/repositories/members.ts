import type { Sql } from "../db/client.ts";
import type { ProjectRole } from "../auth/roles.ts";

export interface Member {
  userId: string;
  name: string;
  email: string;
  role: ProjectRole;
  addedAt: Date;
}

export function membersRepo(sql: Sql) {
  return {
    list(projectId: string): Promise<Member[]> {
      return sql<Member[]>`
        SELECT u.id AS "userId", u.name, u.email, m.role, m.created_at AS "addedAt"
        FROM project_members m JOIN users u ON u.id = m.user_id
        WHERE m.project_id = ${projectId}
        ORDER BY CASE m.role WHEN 'owner' THEN 1 WHEN 'editor' THEN 2 ELSE 3 END, u.name`;
    },

    async find(projectId: string, userId: string): Promise<Member | undefined> {
      const [row] = await sql<Member[]>`
        SELECT u.id AS "userId", u.name, u.email, m.role, m.created_at AS "addedAt"
        FROM project_members m JOIN users u ON u.id = m.user_id
        WHERE m.project_id = ${projectId} AND m.user_id = ${userId}`;
      return row;
    },

    async isMemberByEmail(projectId: string, email: string): Promise<boolean> {
      const rows = await sql`
        SELECT 1 FROM project_members m JOIN users u ON u.id = m.user_id
        WHERE m.project_id = ${projectId} AND lower(u.email) = lower(${email})`;
      return rows.length > 0;
    },

    /**
     * Cuántos owners tiene el proyecto, bloqueando esas filas hasta el fin de la transacción.
     * Así dos owners no pueden degradarse o quitarse a la vez y dejar el proyecto sin dueño.
     */
    async lockOwners(projectId: string): Promise<string[]> {
      const rows = await sql<{ userId: string }[]>`
        SELECT user_id AS "userId" FROM project_members
        WHERE project_id = ${projectId} AND role = 'owner'
        FOR UPDATE`;
      return rows.map((r) => r.userId);
    },

    async add(input: { projectId: string; userId: string; role: ProjectRole; addedBy: string }) {
      await sql`
        INSERT INTO project_members (project_id, user_id, role, added_by)
        VALUES (${input.projectId}, ${input.userId}, ${input.role}, ${input.addedBy})`;
    },

    async setRole(projectId: string, userId: string, role: ProjectRole) {
      await sql`
        UPDATE project_members SET role = ${role}
        WHERE project_id = ${projectId} AND user_id = ${userId}`;
    },

    async remove(projectId: string, userId: string) {
      await sql`DELETE FROM project_members WHERE project_id = ${projectId} AND user_id = ${userId}`;
    },
  };
}
