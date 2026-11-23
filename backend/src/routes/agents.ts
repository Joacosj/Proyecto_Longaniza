import { Hono } from "hono";
import { runAgent, runningAgents } from "../agents/tracker.ts";
import { type ProjectEnv, requireProjectRole } from "../auth/roles.ts";
import { type AuthEnv, requireUser } from "../auth/session.ts";
import { AGENTS } from "../engine/agents.ts";
import { ApiError } from "../http/errors.ts";
import { auditRepo } from "../repositories/audit.ts";
import { buildProjectContext } from "../repositories/context.ts";
import { inconsistenciesRepo } from "../repositories/inconsistencies.ts";
import { questionsRepo } from "../repositories/questions.ts";
import { inTransaction } from "../repositories/tx.ts";
import type { StageDeps } from "./stages.ts";

const SCREEN_ID = /^SCR-\d{1,4}$/;

/** Catálogo de agentes (rol, skills y tools). */
export function agentCatalogRoutes(deps: StageDeps) {
  const r = new Hono<AuthEnv>();
  r.get("/", requireUser(deps), (c) => c.json({ agents: AGENTS }));
  return r;
}

/** Estado de los agentes de un proyecto y las acciones de los agentes de revisión y diseño. */
export function registerAgentRoutes(r: Hono<ProjectEnv>, deps: StageDeps) {
  r.get("/:id/agents", requireProjectRole(deps, "viewer"), async (c) => {
    const projectId = c.get("projectId");
    const running = runningAgents(projectId);
    const last = new Map(
      (await auditRepo(deps.sql).lastByAgent(projectId)).map((l) => [l.agent, l]),
    );
    return c.json({
      agents: AGENTS.map((a) => ({
        ...a,
        working: running.filter((run) => run.agent === a.id),
        lastAction: last.get(a.id) ?? null,
      })),
    });
  });

  // Auditor semántico: agrega sus hallazgos como inconsistencias (advertencias, no bloquean).
  r.post("/:id/semantic-audit", requireProjectRole(deps, "editor"), async (c) => {
    const projectId = c.get("projectId");
    const user = c.get("user");
    const context = await buildProjectContext(deps.sql, projectId);
    if (!context.stages.definition || !context.stages.backend) {
      throw new ApiError("CONFLICT", "El auditor necesita al menos la definición y el backend");
    }
    const found = await runAgent(
      projectId,
      { agent: "auditor", task: "Auditando reglas, permisos y casos borde", userName: user.name },
      () => deps.engine.auditSemantics(context),
    );
    const added = await inTransaction(deps.sql, async (tx) => {
      const n = await inconsistenciesRepo(tx).addAuditorFindings(projectId, found);
      await auditRepo(tx).log({
        projectId,
        userId: user.id,
        action: "agent.audited",
        entityType: "project",
        entityId: projectId,
        detail: { agent: "auditor", found: found.length, added: n },
      });
      return n;
    });
    return c.json({
      found: found.length,
      added,
      inconsistencies: await inconsistenciesRepo(deps.sql).list(projectId, "open"),
    });
  });

  // Revisor externo: lee los documentos como la IA implementadora y deja preguntas.
  r.post("/:id/external-review", requireProjectRole(deps, "editor"), async (c) => {
    const projectId = c.get("projectId");
    const user = c.get("user");
    const context = await buildProjectContext(deps.sql, projectId);
    const missing = (["definition", "database", "backend", "frontend", "architecture"] as const)
      .filter((k) => !context.stages[k]);
    if (missing.length) {
      throw new ApiError(
        "CONFLICT",
        `El revisor necesita todas las etapas; faltan: ${missing.join(", ")}`,
      );
    }
    const findings = await runAgent(
      projectId,
      {
        agent: "revisor",
        task: "Leyendo los documentos como la IA implementadora",
        userName: user.name,
      },
      () => deps.engine.reviewDocuments(context),
    );
    const questions = await inTransaction(deps.sql, async (tx) => {
      const saved = [];
      for (const f of findings) {
        saved.push(
          ...await questionsRepo(tx).insertMany(projectId, f.stage, [{
            text: f.question,
            rationale: `Revisor externo: ${f.rationale}`,
            affects: f.stage === "definition" ? [] : [f.stage],
            isBlocking: false,
          }]),
        );
      }
      await auditRepo(tx).log({
        projectId,
        userId: user.id,
        action: "agent.reviewed",
        entityType: "project",
        entityId: projectId,
        detail: { agent: "revisor", found: findings.length },
      });
      return saved;
    });
    return c.json({ questions });
  });

  // Diseñador visual: vista previa de cómo se vería una pantalla.
  r.get("/:id/screen-previews", requireProjectRole(deps, "viewer"), async (c) => {
    const rows = await deps.sql<
      { screenId: string; html: string; createdAt: Date; createdBy: string | null }[]
    >`
      SELECT p.screen_id AS "screenId", p.html, p.created_at AS "createdAt", u.name AS "createdBy"
      FROM screen_previews p LEFT JOIN users u ON u.id = p.created_by
      WHERE p.project_id = ${c.get("projectId")}`;
    return c.json({ previews: rows });
  });

  r.post("/:id/screens/:screenId/preview", requireProjectRole(deps, "editor"), async (c) => {
    const projectId = c.get("projectId");
    const user = c.get("user");
    const screenId = c.req.param("screenId");
    if (!SCREEN_ID.test(screenId)) throw new ApiError("BAD_REQUEST", "Pantalla inválida");
    const context = await buildProjectContext(deps.sql, projectId);
    if (!context.stages.frontend?.screens.some((s) => s.id === screenId)) {
      throw new ApiError("NOT_FOUND", "La pantalla no existe en la etapa de frontend");
    }
    const { html } = await runAgent(
      projectId,
      { agent: "disenador-visual", task: `Dibujando ${screenId}`, userName: user.name },
      () => deps.engine.designScreen({ context, screenId }),
    );
    const preview = await inTransaction(deps.sql, async (tx) => {
      const [row] = await tx<{ screenId: string; createdAt: Date }[]>`
        INSERT INTO screen_previews (project_id, screen_id, html, created_by)
        VALUES (${projectId}, ${screenId}, ${html}, ${user.id})
        ON CONFLICT (project_id, screen_id)
        DO UPDATE SET html = EXCLUDED.html, created_by = EXCLUDED.created_by, created_at = now()
        RETURNING screen_id AS "screenId", created_at AS "createdAt"`;
      await auditRepo(tx).log({
        projectId,
        userId: user.id,
        action: "agent.designed",
        entityType: "screen",
        entityId: screenId,
        detail: { agent: "disenador-visual" },
      });
      return row;
    });
    return c.json({ preview: { ...preview, html, createdBy: user.name } });
  });
}
