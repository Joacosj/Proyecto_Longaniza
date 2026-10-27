import type { Hono } from "hono";
import type { StageKind } from "../contracts/artifacts.ts";
import type { Sql } from "../db/client.ts";
import type { Engine, GeneratableStage } from "../engine/types.ts";
import { type ProjectEnv, requireProjectRole } from "../auth/roles.ts";
import type { AuthDeps } from "../auth/session.ts";
import { readJsonObject, Validator } from "../http/body.ts";
import { ApiError } from "../http/errors.ts";
import { auditRepo } from "../repositories/audit.ts";
import { buildProjectContext } from "../repositories/context.ts";
import { questionsRepo } from "../repositories/questions.ts";
import {
  isStageKind,
  previousStage,
  type Stage,
  stagesAfter,
  stagesRepo,
} from "../repositories/stages.ts";
import { inTransaction } from "../repositories/tx.ts";

export type StageDeps = AuthDeps & { engine: Engine };

function kindParam(value: string | undefined): StageKind {
  if (!value || !isStageKind(value)) throw new ApiError("NOT_FOUND", "Etapa inexistente");
  return value;
}

/** Quita el id interno antes de responder. */
function publicStage({ id: _id, ...stage }: Stage) {
  return stage;
}

function readVersion(v: Validator, body: Record<string, unknown>, required: boolean) {
  const raw = body.version;
  if (raw === undefined && !required) return undefined;
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 1) {
    v.fail("version", "Debe ser un entero mayor o igual a 1");
    return 0;
  }
  return raw;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 409 con la versión vigente y quién la guardó, para que la interfaz recargue. */
async function versionConflict(sql: Sql, projectId: string, kind: StageKind): Promise<never> {
  const current = await stagesRepo(sql).get(projectId, kind);
  throw new ApiError("CONFLICT", "Otra persona modificó esta etapa", {
    currentVersion: current?.version,
    updatedBy: current?.updatedBy?.name ?? null,
  });
}

/**
 * Guarda un artefacto (edición manual o propuesta de la IA) dentro de una transacción:
 * concurrencia optimista, copia al historial, reapertura de etapas posteriores si estaba
 * aprobada, progreso del proyecto y auditoría.
 */
async function saveStage(tx: Sql, input: {
  projectId: string;
  kind: StageKind;
  expectedVersion: number;
  artifact: Record<string, unknown>;
  source: "ai" | "user";
  userId: string;
}): Promise<{ stage: Stage; reopened: StageKind[] }> {
  const stages = stagesRepo(tx);
  const stage = await stages.get(input.projectId, input.kind);
  if (!stage) throw new ApiError("NOT_FOUND", "Etapa inexistente");
  if (stage.status === "locked") {
    throw new ApiError("CONFLICT", "La etapa está bloqueada: aprueba primero la anterior");
  }

  const saved = await stages.saveArtifact({
    stageId: stage.id,
    expectedVersion: input.expectedVersion,
    artifact: input.artifact,
    userId: input.userId,
  });
  if (!saved) return versionConflict(tx, input.projectId, input.kind);

  await stages.addVersion({
    stageId: stage.id,
    version: saved.version,
    artifact: input.artifact,
    source: input.source,
    userId: input.userId,
  });

  // Editar una etapa aprobada invalida la aprobación de las posteriores.
  const reopened = saved.wasApproved
    ? await stages.reopen(input.projectId, stagesAfter(input.kind))
    : [];
  await stages.syncProjectProgress(input.projectId);

  await auditRepo(tx).log({
    projectId: input.projectId,
    userId: input.userId,
    action: input.source === "ai" ? "stage.generated" : "stage.updated",
    entityType: "stage",
    entityId: input.kind,
    detail: {
      version: saved.version,
      reopened: saved.wasApproved ? [input.kind, ...reopened] : [],
    },
  });

  return { stage: (await stages.get(input.projectId, input.kind))!, reopened };
}

export function registerStageRoutes(r: Hono<ProjectEnv>, deps: StageDeps) {
  r.get("/:id/stages", requireProjectRole(deps, "viewer"), async (c) => {
    return c.json({ stages: await stagesRepo(deps.sql).list(c.get("projectId")) });
  });

  r.get("/:id/stages/:kind", requireProjectRole(deps, "viewer"), async (c) => {
    const stage = await stagesRepo(deps.sql).get(
      c.get("projectId"),
      kindParam(c.req.param("kind")),
    );
    if (!stage) throw new ApiError("NOT_FOUND", "Etapa inexistente");
    return c.json({ stage: publicStage(stage) });
  });

  r.get("/:id/stages/:kind/versions", requireProjectRole(deps, "viewer"), async (c) => {
    const stages = stagesRepo(deps.sql);
    const stage = await stages.get(c.get("projectId"), kindParam(c.req.param("kind")));
    if (!stage) throw new ApiError("NOT_FOUND", "Etapa inexistente");
    return c.json({ versions: await stages.versions(stage.id) });
  });

  r.put("/:id/stages/:kind", requireProjectRole(deps, "editor"), async (c) => {
    const kind = kindParam(c.req.param("kind"));
    if (kind === "review") {
      throw new ApiError("CONFLICT", "La etapa de revisión no tiene contenido editable");
    }
    const body = await readJsonObject(c);
    const v = new Validator(body);
    const version = readVersion(v, body, true)!;
    if (!isPlainObject(body.artifact)) v.fail("artifact", "Debe ser un objeto JSON");
    v.done();

    const { stage } = await inTransaction(deps.sql, (tx) =>
      saveStage(tx, {
        projectId: c.get("projectId"),
        kind,
        expectedVersion: version,
        artifact: body.artifact as Record<string, unknown>,
        source: "user",
        userId: c.get("user").id,
      }));
    return c.json({ stage: publicStage(stage) });
  });

  r.post("/:id/stages/:kind/approve", requireProjectRole(deps, "editor"), async (c) => {
    const projectId = c.get("projectId");
    const kind = kindParam(c.req.param("kind"));
    const body = await readJsonObject(c);
    const v = new Validator(body);
    const version = readVersion(v, body, true)!;
    v.done();

    const stage = await inTransaction(deps.sql, async (tx) => {
      const stages = stagesRepo(tx);
      const current = await stages.get(projectId, kind);
      if (!current) throw new ApiError("NOT_FOUND", "Etapa inexistente");
      if (current.version !== version) return versionConflict(tx, projectId, kind);
      if (current.status === "locked") {
        throw new ApiError("CONFLICT", "La etapa está bloqueada: aprueba primero la anterior");
      }
      if (current.status === "approved") {
        throw new ApiError("CONFLICT", "La etapa ya está aprobada");
      }

      const prev = previousStage(kind);
      if (prev && (await stages.get(projectId, prev))?.status !== "approved") {
        throw new ApiError("CONFLICT", "Aprueba primero la etapa anterior", { pending: prev });
      }
      if (kind !== "review" && Object.keys(current.artifact).length === 0) {
        throw new ApiError("CONFLICT", "La etapa está vacía: genera o edita su contenido");
      }

      const blocking = await questionsRepo(tx).openBlocking(projectId, kind);
      if (blocking.length > 0) {
        throw new ApiError("CONFLICT", "Hay preguntas bloqueantes sin responder en esta etapa", {
          blockingQuestions: blocking.map((q) => ({ id: q.id, text: q.text })),
        });
      }

      const newVersion = await stages.approve({
        stageId: current.id,
        expectedVersion: version,
        userId: c.get("user").id,
      });
      if (newVersion === undefined) return versionConflict(tx, projectId, kind);

      const next = stagesAfter(kind)[0];
      if (next) await stages.unlock(projectId, next);
      await stages.syncProjectProgress(projectId);

      await auditRepo(tx).log({
        projectId,
        userId: c.get("user").id,
        action: "stage.approved",
        entityType: "stage",
        entityId: kind,
        detail: { version: newVersion, unlocked: next ?? null },
      });
      return (await stages.get(projectId, kind))!;
    });

    return c.json({ stage: publicStage(stage) });
  });

  r.post("/:id/stages/:kind/generate", requireProjectRole(deps, "editor"), async (c) => {
    const projectId = c.get("projectId");
    const kind = kindParam(c.req.param("kind"));
    if (kind === "review") {
      throw new ApiError("CONFLICT", "La etapa de revisión no se genera; usa /documents");
    }
    // El cuerpo es opcional: { version } para fijar sobre qué versión se genera.
    const raw = await c.req.text();
    let body: Record<string, unknown> = {};
    if (raw.trim()) {
      try {
        const parsed = JSON.parse(raw);
        if (!isPlainObject(parsed)) throw new Error();
        body = parsed;
      } catch {
        throw new ApiError("BAD_REQUEST", "El cuerpo debe ser un objeto JSON");
      }
    }
    const v = new Validator(body);
    const requested = readVersion(v, body, false);
    v.done();

    const stage = await stagesRepo(deps.sql).get(projectId, kind);
    if (!stage) throw new ApiError("NOT_FOUND", "Etapa inexistente");
    if (stage.status === "locked") {
      throw new ApiError("CONFLICT", "La etapa está bloqueada: aprueba primero la anterior");
    }
    const expectedVersion = requested ?? stage.version;
    if (expectedVersion !== stage.version) return versionConflict(deps.sql, projectId, kind);

    // La llamada a la IA puede tardar: se hace fuera de la transacción. Si alguien guarda
    // mientras tanto, el guardado de abajo responde 409.
    const context = await buildProjectContext(deps.sql, projectId);
    const result = await deps.engine.generate({ context, stage: kind as GeneratableStage });

    const saved = await inTransaction(deps.sql, async (tx) => {
      const out = await saveStage(tx, {
        projectId,
        kind,
        expectedVersion,
        artifact: result.artifact as unknown as Record<string, unknown>,
        source: "ai",
        userId: c.get("user").id,
      });
      const questions = await questionsRepo(tx).insertMany(projectId, kind, result.questions);
      return { stage: out.stage, questions };
    });

    return c.json({ stage: publicStage(saved.stage), questions: saved.questions });
  });
}
