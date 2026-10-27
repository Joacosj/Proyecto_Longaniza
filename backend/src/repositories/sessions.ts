import type { Sql } from "../db/client.ts";
import type { PublicUser } from "./users.ts";

export interface SessionWithUser {
  sessionId: string;
  user: PublicUser;
}

export function sessionsRepo(sql: Sql) {
  return {
    async create(input: { userId: string; tokenHash: string; expiresAt: Date }) {
      const [row] = await sql<{ id: string }[]>`
        INSERT INTO sessions (user_id, token_hash, expires_at)
        VALUES (${input.userId}, ${input.tokenHash}, ${input.expiresAt})
        RETURNING id`;
      return row.id;
    },

    /** Busca una sesión vigente por el hash de su token. */
    async findValid(tokenHash: string): Promise<SessionWithUser | undefined> {
      const [row] = await sql<{ sessionId: string; id: string; email: string; name: string }[]>`
        SELECT s.id AS "sessionId", u.id, u.email, u.name
        FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = ${tokenHash} AND s.expires_at > now()`;
      if (!row) return undefined;
      return { sessionId: row.sessionId, user: { id: row.id, email: row.email, name: row.name } };
    },

    async delete(sessionId: string) {
      await sql`DELETE FROM sessions WHERE id = ${sessionId}`;
    },

    /** Limpieza oportunista: borra las sesiones vencidas de un usuario. */
    async deleteExpiredFor(userId: string) {
      await sql`DELETE FROM sessions WHERE user_id = ${userId} AND expires_at <= now()`;
    },
  };
}
