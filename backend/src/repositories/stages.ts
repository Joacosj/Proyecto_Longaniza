import { STAGE_ORDER, type StageKind } from "../contracts/artifacts.ts";
import type { Sql } from "../db/client.ts";

export type StageStatus = "locked" | "in_progress" | "approved";

export interface UserRef {
  id: string;
  name: string;
}

export interface StageSummary {
  kind: StageKind;
  status: StageStatus;
  version: number;
  updatedAt: Date;
  updatedBy: UserRef | null;
  approvedAt: Date | null;
  approvedBy: UserRef | null;
}

export interface Stage extends StageSummary {
  id: string;
  artifact: Record<string, unknown>;
}

export interface StageVersion {
  version: number;
  source: "ai" | "user";
  artifact: Record<string, unknown>;
  createdAt: Date;
  createdBy: UserRef | null;
}

export function isStageKind(value: string): value is StageKind {
  return (STAGE_ORDER as string[]).includes(value);
}

/** Etapas posteriores a `kind`, en orden. */
export function stagesAfter(kind: StageKind): StageKind[] {
  return STAGE_ORDER.slice(STAGE_ORDER.indexOf(kind) + 1);
}

export function previousStage(kind: StageKind): StageKind | undefined {
  const i = STAGE_ORDER.indexOf(kind);
  return i > 0 ? STAGE_ORDER[i - 1] : undefined;
}

type Row = {
  id: string;
  kind: StageKind;
  status: StageStatus;
  version: number;
  artifact: Record<string, unknown>;
  updatedAt: Date;
  updatedById: string | null;
  updatedByName: string | null;
  approvedAt: Date | null;
  approvedById: string | null;
  approvedByName: string | null;
};

const ref = (id: string | null, name: string | null): UserRef | null =>
  id ? { id, name: name ?? "" } : null;

function toStage(r: Row): Stage {
  return {
    id: r.id,
    kind: r.kind,
    status: r.status,
    version: r.version,
    artifact: r.artifact,
    updatedAt: r.updatedAt,
    updatedBy: ref(r.updatedById, r.updatedByName),
    approvedAt: r.approvedAt,
    approvedBy: ref(r.approvedById, r.approvedByName),
  };
}

function toSummary(r: Row): StageSummary {
  const { id: _id, artifact: _a, ...rest } = toStage(r);
  return rest;
}

const SELECT = (sql: Sql) =>
  sql`
    SELECT s.id, s.kind, s.status, s.version, s.artifact, s.updated_at AS "updatedAt",
           uu.id AS "updatedById", uu.name AS "updatedByName",
           s.approved_at AS "approvedAt", ua.id AS "approvedById", ua.name AS "approvedByName"
    FROM stages s
    LEFT JOIN users uu ON uu.id = s.updated_by
    LEFT JOIN users ua ON ua.id = s.approved_by`;

export function stagesRepo(sql: Sql) {
  return {
    async list(projectId: string): Promise<StageSummary[]> {
      const rows = await sql<Row[]>`${SELECT(sql)} WHERE s.project_id = ${projectId}`;
      return rows
        .map(toSummary)
        .sort((a, b) => STAGE_ORDER.indexOf(a.kind) - STAGE_ORDER.indexOf(b.kind));
    },

    async listFull(projectId: string): Promise<Stage[]> {
      const rows = await sql<Row[]>`${SELECT(sql)} WHERE s.project_id = ${projectId}`;
      return rows
        .map(toStage)
        .sort((a, b) => STAGE_ORDER.indexOf(a.kind) - STAGE_ORDER.indexOf(b.kind));
    },

    async get(projectId: string, kind: StageKind): Promise<Stage | undefined> {
      const [row] = await sql<Row[]>`
        ${SELECT(sql)} WHERE s.project_id = ${projectId} AND s.kind = ${kind}`;
      return row ? toStage(row) : undefined;
    },

    /**
     * Guarda el artefacto solo si la versión guardada sigue siendo `expectedVersion`
     * (concurrencia optimista). Devuelve la nueva versión, o undefined si otra persona
     * guardó antes. Si la etapa estaba aprobada, vuelve a `in_progress`.
     */
    async saveArtifact(input: {
      stageId: string;
      expectedVersion: number;
      artifact: unknown;
      userId: string;
    }): Promise<{ version: number; wasApproved: boolean } | undefined> {
      const [row] = await sql<{ version: number; wasApproved: boolean }[]>`
        UPDATE stages s SET
          artifact = ${sql.json(input.artifact as never)},
          version = s.version + 1,
          status = 'in_progress',
          approved_by = NULL,
          approved_at = NULL,
          updated_by = ${input.userId},
          updated_at = now()
        FROM (SELECT id, status = 'approved' AS was FROM stages WHERE id = ${input.stageId}) old
        WHERE s.id = old.id AND s.version = ${input.expectedVersion}
        RETURNING s.version, old.was AS "wasApproved"`;
      return row;
    },

    /** Copia inmutable de un guardado en el historial. */
    async addVersion(input: {
      stageId: string;
      version: number;
      artifact: unknown;
      source: "ai" | "user";
      userId: string;
    }) {
      await sql`
        INSERT INTO stage_versions (stage_id, version, artifact, source, created_by)
        VALUES (${input.stageId}, ${input.version}, ${sql.json(input.artifact as never)},
                ${input.source}, ${input.userId})`;
    },

    /** Aprueba con concurrencia optimista. Devuelve la nueva versión o undefined. */
    async approve(input: { stageId: string; expectedVersion: number; userId: string }) {
      const [row] = await sql<{ version: number }[]>`
        UPDATE stages SET
          status = 'approved',
          version = version + 1,
          approved_by = ${input.userId},
          approved_at = now(),
          updated_by = ${input.userId},
          updated_at = now()
        WHERE id = ${input.stageId} AND version = ${input.expectedVersion}
          AND status = 'in_progress'
        RETURNING version`;
      return row?.version;
    },

    /** Desbloquea una etapa (locked → in_progress). No toca etapas ya trabajadas. */
    async unlock(projectId: string, kind: StageKind) {
      await sql`
        UPDATE stages SET status = 'in_progress', updated_at = now()
        WHERE project_id = ${projectId} AND kind = ${kind} AND status = 'locked'`;
    },

    /** Quita la aprobación a las etapas indicadas que estén aprobadas. */
    async reopen(projectId: string, kinds: StageKind[]): Promise<StageKind[]> {
      if (kinds.length === 0) return [];
      const rows = await sql<{ kind: StageKind }[]>`
        UPDATE stages SET status = 'in_progress', approved_by = NULL, approved_at = NULL,
                          updated_at = now()
        WHERE project_id = ${projectId} AND kind IN ${sql(kinds)} AND status = 'approved'
        RETURNING kind`;
      return rows.map((r) => r.kind);
    },

    async versions(stageId: string): Promise<StageVersion[]> {
      const rows = await sql<
        (Omit<StageVersion, "createdBy"> & { userId: string | null; userName: string | null })[]
      >`
        SELECT v.version, v.source, v.artifact, v.created_at AS "createdAt",
               u.id AS "userId", u.name AS "userName"
        FROM stage_versions v LEFT JOIN users u ON u.id = v.created_by
        WHERE v.stage_id = ${stageId}
        ORDER BY v.version DESC`;
      return rows.map(({ userId, userName, ...v }) => ({ ...v, createdBy: ref(userId, userName) }));
    },

    /**
     * Recalcula `projects.current_stage` (primera etapa no aprobada) y el estado del
     * proyecto: `ready` si todas están aprobadas, `in_progress` si no.
     */
    async syncProjectProgress(projectId: string) {
      const rows = await sql<{ kind: StageKind; status: StageStatus }[]>`
        SELECT kind, status FROM stages WHERE project_id = ${projectId}`;
      const status = new Map(rows.map((r) => [r.kind, r.status]));
      const current = STAGE_ORDER.find((k) => status.get(k) !== "approved");
      await sql`
        UPDATE projects SET
          current_stage = ${current ?? "review"},
          status = CASE
            WHEN ${current === undefined} THEN
              CASE WHEN status = 'generated' THEN 'generated' ELSE 'ready' END
            ELSE 'in_progress' END,
          updated_at = now()
        WHERE id = ${projectId}`;
    },
  };
}
