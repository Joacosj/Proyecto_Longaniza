import type { Sql } from "../db/client.ts";

export type InvitationRole = "editor" | "viewer";

export interface Invitation {
  id: string;
  projectId: string;
  email: string;
  role: InvitationRole;
  status: "pending" | "accepted" | "revoked" | "expired";
  invitedBy: string;
  expiresAt: Date;
  createdAt: Date;
}

const COLUMNS = (sql: Sql) =>
  sql`id, project_id AS "projectId", email, role, status, invited_by AS "invitedBy",
      expires_at AS "expiresAt", created_at AS "createdAt"`;

export function invitationsRepo(sql: Sql) {
  return {
    async create(input: {
      projectId: string;
      email: string;
      role: InvitationRole;
      tokenHash: string;
      invitedBy: string;
      expiresAt: Date;
    }): Promise<Invitation> {
      const [row] = await sql<Invitation[]>`
        INSERT INTO invitations (project_id, email, role, token_hash, invited_by, expires_at)
        VALUES (${input.projectId}, ${input.email}, ${input.role}, ${input.tokenHash},
                ${input.invitedBy}, ${input.expiresAt})
        RETURNING ${COLUMNS(sql)}`;
      return row;
    },

    /** Invitaciones pendientes y vigentes de un proyecto. */
    listPending(projectId: string): Promise<Invitation[]> {
      return sql<Invitation[]>`
        SELECT ${COLUMNS(sql)} FROM invitations
        WHERE project_id = ${projectId} AND status = 'pending' AND expires_at > now()
        ORDER BY created_at DESC`;
    },

    /** Revoca las pendientes para ese correo (al reenviar, la anterior deja de servir). */
    async revokePendingFor(projectId: string, email: string) {
      await sql`
        UPDATE invitations SET status = 'revoked'
        WHERE project_id = ${projectId} AND lower(email) = lower(${email}) AND status = 'pending'`;
    },

    /** Busca por hash del token y bloquea la fila para aceptarla una sola vez. */
    async findByTokenForUpdate(tokenHash: string): Promise<Invitation | undefined> {
      const [row] = await sql<Invitation[]>`
        SELECT ${COLUMNS(sql)} FROM invitations WHERE token_hash = ${tokenHash} FOR UPDATE`;
      return row;
    },

    async setStatus(id: string, status: Invitation["status"]) {
      await sql`UPDATE invitations SET status = ${status} WHERE id = ${id}`;
    },
  };
}
