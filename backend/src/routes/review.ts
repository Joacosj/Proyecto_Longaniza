import type { Hono } from "hono";
import { STAGE_ORDER, type StageKind } from "../contracts/artifacts.ts";
import type { Sql } from "../db/client.ts";
import { isUuid, type ProjectEnv, requireProjectRole } from "../auth/roles.ts";
import { readJsonObject, Validator } from "../http/body.ts";
import { ApiError } from "../http/errors.ts";
import { auditRepo } from "../repositories/audit.ts";
import { buildProjectContext } from "../repositories/context.ts";
import { DOCUMENT_KINDS, type DocumentKind, documentsRepo } from "../repositories/documents.ts";
import { inconsistenciesRepo } from "../repositories/inconsistencies.ts";
import { questionsRepo } from "../repositories/questions.ts";
import { stagesRepo } from "../repositories/stages.ts";
import { inTransaction } from "../repositories/tx.ts";
import type { StageDeps } from "./stages.ts";

/** Las etapas con contenido; `review` no se aprueba para generar documentos. */
const CONTENT_STAGES = STAGE_ORDER.filter((k) => k !== "review");

const FILE_NAMES: Record<DocumentKind, string> = {
  product_spec: "especificacion-producto",
  architecture: "arquitectura",
};

export interface Pending {
  unapprovedStages: StageKind[];
  blockingQuestions: { id: string; stageKind: StageKind; text: string }[];
  criticalInconsistencies: { id: string; stages: StageKind[]; description: string }[];
}

/** Lo que impide generar los documentos finales. Vacío en las tres listas = se puede. */
export async function computePending(sql: Sql, projectId: string): Promise<Pending> {
  const stages = await stagesRepo(sql).list(projectId);
  const blocking = await questionsRepo(sql).openBlocking(projectId);
  const open = await inconsistenciesRepo(sql).list(projectId, "open");
  return {
    unapprovedStages: CONTENT_STAGES.filter((k) =>
      stages.find((s) => s.kind === k)?.status !== "approved"
    ),
    blockingQuestions: blocking.map((q) => ({ id: q.id, stageKind: q.stageKind, text: q.text })),
    criticalInconsistencies: open
      .filter((i) => i.severity === "critical")
      .map((i) => ({ id: i.id, stages: i.stages, description: i.description })),
  };
}

export const hasPending = (p: Pending) =>
  p.unapprovedStages.length + p.blockingQuestions.length + p.criticalInconsistencies.length > 0;

/** Corre el validador del motor y guarda el resultado. */
async function runConsistencyCheck(deps: StageDeps, projectId: string, userId: string) {
  const context = await buildProjectContext(deps.sql, projectId);
  const found = deps.engine.checkConsistency(context);
  return await inTransaction(deps.sql, async (tx) => {
    const result = await inconsistenciesRepo(tx).sync(projectId, found);
    await auditRepo(tx).log({
      projectId,
      userId,
      action: "consistency.checked",
      entityType: "project",
      entityId: projectId,
      detail: { found: found.length, ...result },
    });
    return result;
  });
}

/** Revisión final, validador de consistencia y documentos, dentro de un proyecto. */
export function registerReviewRoutes(r: Hono<ProjectEnv>, deps: StageDeps) {
  r.get("/:id/review", requireProjectRole(deps, "viewer"), async (c) => {
    const projectId = c.get("projectId");
    const pending = await computePending(deps.sql, projectId);
    return c.json({
      stages: await stagesRepo(deps.sql).list(projectId),
      pending,
      canGenerateDocuments: !hasPending(pending),
      inconsistencies: await inconsistenciesRepo(deps.sql).list(projectId, "open"),
      documents: await documentsRepo(deps.sql).list(projectId),
    });
  });

  r.post("/:id/consistency-check", requireProjectRole(deps, "editor"), async (c) => {
    const projectId = c.get("projectId");
    const result = await runConsistencyCheck(deps, projectId, c.get("user").id);
    return c.json({
      ...result,
      inconsistencies: await inconsistenciesRepo(deps.sql).list(projectId, "open"),
    });
  });

  r.patch("/:id/inconsistencies/:incId", requireProjectRole(deps, "editor"), async (c) => {
    const projectId = c.get("projectId");
    const incId = c.req.param("incId");
    const body = await readJsonObject(c);
    const v = new Validator(body);
    if (body.status !== "resolved") v.fail("status", 'Debe ser "resolved"');
    v.done();

    const inconsistency = await inTransaction(deps.sql, async (tx) => {
      const repo = inconsistenciesRepo(tx);
      const inc = isUuid(incId) ? await repo.find(projectId, incId) : undefined;
      if (!inc) throw new ApiError("NOT_FOUND", "La inconsistencia no existe en este proyecto");
      if (inc.status === "resolved") return inc;
      await repo.resolve(inc.id, c.get("user").id);
      await auditRepo(tx).log({
        projectId,
        userId: c.get("user").id,
        action: "inconsistency.resolved",
        entityType: "inconsistency",
        entityId: inc.id,
        detail: { severity: inc.severity, description: inc.description },
      });
      return (await repo.find(projectId, inc.id))!;
    });

    return c.json({ inconsistency });
  });

  r.post("/:id/documents", requireProjectRole(deps, "editor"), async (c) => {
    const projectId = c.get("projectId");
    const userId = c.get("user").id;

    // Se valida otra vez antes de generar: el estado guardado podría estar desactualizado.
    await runConsistencyCheck(deps, projectId, userId);
    const pending = await computePending(deps.sql, projectId);
    if (hasPending(pending)) {
      throw new ApiError("CONFLICT", "Hay pendientes que impiden generar los documentos", {
        pending,
      });
    }

    const context = await buildProjectContext(deps.sql, projectId);
    let rendered: { productSpec: string; architecture: string };
    try {
      rendered = deps.engine.renderDocuments(context);
    } catch (err) {
      throw new ApiError(
        "CONFLICT",
        `El contenido de las etapas está incompleto: ${(err as Error).message}`,
      );
    }

    const version = await inTransaction(deps.sql, async (tx) => {
      const v = await documentsRepo(tx).addVersion({ projectId, userId, ...rendered });
      await tx`UPDATE projects SET status = 'generated', updated_at = now() WHERE id = ${projectId}`;
      await auditRepo(tx).log({
        projectId,
        userId,
        action: "documents.generated",
        entityType: "documents",
        entityId: String(v),
        detail: { version: v },
      });
      return v;
    });

    const documents = (await documentsRepo(deps.sql).list(projectId))
      .filter((d) => d.version === version);
    return c.json({ version, documents }, 201);
  });

  r.get("/:id/documents", requireProjectRole(deps, "viewer"), async (c) => {
    return c.json({ documents: await documentsRepo(deps.sql).list(c.get("projectId")) });
  });

  r.get("/:id/documents/:kind", requireProjectRole(deps, "viewer"), async (c) => {
    const kind = c.req.param("kind") as DocumentKind;
    if (!DOCUMENT_KINDS.includes(kind)) {
      throw new ApiError("NOT_FOUND", "Documento inexistente (product_spec o architecture)");
    }
    const versionQ = c.req.query("version");
    const version = versionQ ? Number(versionQ) : undefined;
    if (versionQ && (!Number.isInteger(version) || version! < 1)) {
      throw new ApiError("BAD_REQUEST", "Parámetro version inválido");
    }

    const doc = await documentsRepo(deps.sql).get(c.get("projectId"), kind, version);
    if (!doc) throw new ApiError("NOT_FOUND", "Aún no se ha generado ese documento");

    c.header("Content-Type", "text/markdown; charset=utf-8");
    c.header(
      "Content-Disposition",
      `attachment; filename="${FILE_NAMES[kind]}-v${doc.version}.md"`,
    );
    return c.body(doc.content);
  });
}
