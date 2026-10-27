import type { StageKind } from "../contracts/artifacts.ts";
import type { Sql } from "../db/client.ts";
import type { Inconsistency as Found } from "../engine/types.ts";

export interface Inconsistency {
  id: string;
  stages: StageKind[];
  description: string;
  severity: "critical" | "warning";
  status: "open" | "resolved";
  resolvedBy: { id: string; name: string } | null;
  resolvedAt: Date | null;
  createdAt: Date;
}

type Row = Omit<Inconsistency, "resolvedBy"> & {
  resolvedById: string | null;
  resolvedByName: string | null;
};

const SELECT = (sql: Sql) =>
  sql`
    SELECT i.id, i.stages, i.description, i.severity, i.status, i.resolved_at AS "resolvedAt",
           i.created_at AS "createdAt", u.id AS "resolvedById", u.name AS "resolvedByName"
    FROM inconsistencies i LEFT JOIN users u ON u.id = i.resolved_by`;

const toInc = ({ resolvedById, resolvedByName, ...i }: Row): Inconsistency => ({
  ...i,
  resolvedBy: resolvedById ? { id: resolvedById, name: resolvedByName ?? "" } : null,
});

/** Clave para reconocer la misma inconsistencia entre dos ejecuciones del validador. */
const keyOf = (i: { stages: string[]; description: string; severity: string }) =>
  `${i.severity}|${[...i.stages].sort().join(",")}|${i.description}`;

export function inconsistenciesRepo(sql: Sql) {
  return {
    async list(projectId: string, status?: "open" | "resolved"): Promise<Inconsistency[]> {
      const rows = await sql<Row[]>`
        ${SELECT(sql)}
        WHERE i.project_id = ${projectId} ${status ? sql`AND i.status = ${status}` : sql``}
        ORDER BY CASE i.severity WHEN 'critical' THEN 1 ELSE 2 END, i.created_at, i.id`;
      return rows.map(toInc);
    },

    async find(projectId: string, id: string): Promise<Inconsistency | undefined> {
      const [row] = await sql<Row[]>`
        ${SELECT(sql)} WHERE i.project_id = ${projectId} AND i.id = ${id}`;
      return row ? toInc(row) : undefined;
    },

    /**
     * Sincroniza las abiertas con lo que reporta el validador ahora: las que siguen se
     * conservan (mismo id), las nuevas se agregan y las que ya no aparecen se marcan resueltas
     * automáticamente (resolved_by NULL). Devuelve cuántas se agregaron y resolvieron.
     */
    async sync(projectId: string, found: Found[]) {
      const open = await this.list(projectId, "open");
      const openKeys = new Map(open.map((i) => [keyOf(i), i.id]));
      const foundKeys = new Set(found.map(keyOf));

      const gone = open.filter((i) => !foundKeys.has(keyOf(i))).map((i) => i.id);
      if (gone.length) {
        await sql`
          UPDATE inconsistencies SET status = 'resolved', resolved_at = now(), resolved_by = NULL
          WHERE id IN ${sql(gone)}`;
      }

      // Las que una persona marcó como resueltas no se vuelven a abrir aunque el validador
      // las siga reportando: es una decisión explícita del equipo.
      const manual = await sql<{ stages: string[]; description: string; severity: string }[]>`
        SELECT stages, description, severity FROM inconsistencies
        WHERE project_id = ${projectId} AND status = 'resolved' AND resolved_by IS NOT NULL`;
      const manualKeys = new Set(manual.map(keyOf));

      const seen = new Set<string>(manualKeys);
      const fresh = found.filter((f) => {
        const k = keyOf(f);
        if (openKeys.has(k) || seen.has(k)) return false;
        seen.add(k);
        return true;
      });
      if (fresh.length) {
        const rows = fresh.map((f) => ({
          project_id: projectId,
          stages: f.stages,
          description: f.description,
          severity: f.severity,
        }));
        await sql`
          INSERT INTO inconsistencies ${
          sql(rows, "project_id", "stages", "description", "severity")
        }`;
      }
      return { added: fresh.length, autoResolved: gone.length };
    },

    async resolve(id: string, userId: string) {
      await sql`
        UPDATE inconsistencies SET status = 'resolved', resolved_by = ${userId}, resolved_at = now()
        WHERE id = ${id}`;
    },
  };
}
