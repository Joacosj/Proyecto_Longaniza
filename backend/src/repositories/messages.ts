import type { StageKind } from "../contracts/artifacts.ts";
import type { Sql } from "../db/client.ts";

export interface Message {
  id: string;
  stageKind: StageKind;
  role: "user" | "assistant";
  content: string;
  /** NULL cuando habla la IA. */
  user: { id: string; name: string } | null;
  createdAt: Date;
}

type Row = Omit<Message, "user"> & { userId: string | null; userName: string | null };

const toMessage = ({ userId, userName, ...m }: Row): Message => ({
  ...m,
  user: userId ? { id: userId, name: userName ?? "" } : null,
});

export function messagesRepo(sql: Sql) {
  return {
    /** Mensajes en orden cronológico, opcionalmente de una sola etapa. */
    async list(projectId: string, stage?: StageKind): Promise<Message[]> {
      const rows = await sql<Row[]>`
        SELECT m.id, m.stage_kind AS "stageKind", m.role, m.content, m.created_at AS "createdAt",
               u.id AS "userId", u.name AS "userName"
        FROM messages m LEFT JOIN users u ON u.id = m.user_id
        WHERE m.project_id = ${projectId}
          ${stage ? sql`AND m.stage_kind = ${stage}` : sql``}
        ORDER BY m.created_at, m.id`;
      return rows.map(toMessage);
    },

    async add(input: {
      projectId: string;
      stage: StageKind;
      role: "user" | "assistant";
      content: string;
      userId: string | null;
    }): Promise<Message> {
      // clock_timestamp() y no now(): dentro de una transacción now() es fijo y la respuesta
      // de la IA quedaría con la misma hora que el mensaje del usuario.
      const [row] = await sql<{ id: string }[]>`
        INSERT INTO messages (project_id, stage_kind, role, user_id, content, created_at)
        VALUES (${input.projectId}, ${input.stage}, ${input.role}, ${input.userId},
                ${input.content}, clock_timestamp())
        RETURNING id`;
      const [full] = await sql<Row[]>`
        SELECT m.id, m.stage_kind AS "stageKind", m.role, m.content, m.created_at AS "createdAt",
               u.id AS "userId", u.name AS "userName"
        FROM messages m LEFT JOIN users u ON u.id = m.user_id
        WHERE m.id = ${row.id}`;
      return toMessage(full);
    },
  };
}
