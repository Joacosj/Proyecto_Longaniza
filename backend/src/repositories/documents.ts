import type { Sql } from "../db/client.ts";

export type DocumentKind = "product_spec" | "architecture";
export const DOCUMENT_KINDS: DocumentKind[] = ["product_spec", "architecture"];

export interface DocumentInfo {
  kind: DocumentKind;
  version: number;
  createdAt: Date;
  generatedBy: { id: string; name: string };
}

export function documentsRepo(sql: Sql) {
  return {
    /** Guarda una nueva versión de cada documento (misma versión para ambos). */
    async addVersion(input: {
      projectId: string;
      userId: string;
      productSpec: string;
      architecture: string;
    }): Promise<number> {
      // Bloquea el proyecto para que dos generaciones simultáneas no choquen en la versión.
      await sql`SELECT 1 FROM projects WHERE id = ${input.projectId} FOR UPDATE`;
      const [{ next }] = await sql<{ next: number }[]>`
        SELECT COALESCE(max(version), 0) + 1 AS next
        FROM generated_documents WHERE project_id = ${input.projectId}`;
      await sql`
        INSERT INTO generated_documents (project_id, kind, version, content, generated_by)
        VALUES (${input.projectId}, 'product_spec', ${next}, ${input.productSpec}, ${input.userId}),
               (${input.projectId}, 'architecture', ${next}, ${input.architecture}, ${input.userId})`;
      return next;
    },

    async list(projectId: string): Promise<DocumentInfo[]> {
      const rows = await sql<
        (Omit<DocumentInfo, "generatedBy"> & { userId: string; userName: string })[]
      >`
        SELECT d.kind, d.version, d.created_at AS "createdAt", u.id AS "userId",
               u.name AS "userName"
        FROM generated_documents d JOIN users u ON u.id = d.generated_by
        WHERE d.project_id = ${projectId}
        ORDER BY d.version DESC, d.kind`;
      return rows.map(({ userId, userName, ...d }) => ({
        ...d,
        generatedBy: { id: userId, name: userName },
      }));
    },

    /** Contenido de un documento: la última versión, o la indicada. */
    async get(projectId: string, kind: DocumentKind, version?: number) {
      const [row] = await sql<{ version: number; content: string }[]>`
        SELECT version, content FROM generated_documents
        WHERE project_id = ${projectId} AND kind = ${kind}
          ${version ? sql`AND version = ${version}` : sql``}
        ORDER BY version DESC LIMIT 1`;
      return row;
    },
  };
}
