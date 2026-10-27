import type { StageKind } from "../contracts/artifacts.ts";
import type { Sql } from "../db/client.ts";
import type { NewQuestion } from "../engine/types.ts";

export interface Question {
  id: string;
  stageKind: StageKind;
  text: string;
  rationale: string;
  affects: string[];
  isBlocking: boolean;
  status: "open" | "answered" | "deferred";
  answer: string | null;
  answeredBy: { id: string; name: string } | null;
  answeredAt: Date | null;
  createdAt: Date;
}

type Row = Omit<Question, "answeredBy"> & {
  answeredById: string | null;
  answeredByName: string | null;
};

const SELECT = (sql: Sql) =>
  sql`
    SELECT q.id, q.stage_kind AS "stageKind", q.text, q.rationale, q.affects,
           q.is_blocking AS "isBlocking", q.status, q.answer, q.answered_at AS "answeredAt",
           q.created_at AS "createdAt", u.id AS "answeredById", u.name AS "answeredByName"
    FROM questions q LEFT JOIN users u ON u.id = q.answered_by`;

const toQuestion = ({ answeredById, answeredByName, ...q }: Row): Question => ({
  ...q,
  answeredBy: answeredById ? { id: answeredById, name: answeredByName ?? "" } : null,
});

export function questionsRepo(sql: Sql) {
  return {
    async list(
      projectId: string,
      filter: { stage?: StageKind; status?: Question["status"]; blocking?: boolean } = {},
    ): Promise<Question[]> {
      const rows = await sql<Row[]>`
        ${SELECT(sql)}
        WHERE q.project_id = ${projectId}
          ${filter.stage ? sql`AND q.stage_kind = ${filter.stage}` : sql``}
          ${filter.status ? sql`AND q.status = ${filter.status}` : sql``}
          ${filter.blocking !== undefined ? sql`AND q.is_blocking = ${filter.blocking}` : sql``}
        ORDER BY q.created_at, q.id`;
      return rows.map(toQuestion);
    },

    /** Preguntas bloqueantes abiertas. Sin `stage`, las de todo el proyecto. */
    openBlocking(projectId: string, stage?: StageKind): Promise<Question[]> {
      return this.list(projectId, { stage, status: "open", blocking: true });
    },

    async insertMany(projectId: string, stage: StageKind, items: NewQuestion[]) {
      if (items.length === 0) return [];
      const rows = items.map((q) => ({
        project_id: projectId,
        stage_kind: stage,
        text: q.text,
        rationale: q.rationale,
        affects: q.affects,
        is_blocking: q.isBlocking,
      }));
      const inserted = await sql<{ id: string }[]>`
        INSERT INTO questions ${
        sql(rows, "project_id", "stage_kind", "text", "rationale", "affects", "is_blocking")
      }
        RETURNING id`;
      const ids = inserted.map((r) => r.id);
      const all = await sql<Row[]>`${SELECT(sql)} WHERE q.id IN ${sql(ids)} ORDER BY q.created_at`;
      return all.map(toQuestion);
    },
  };
}
