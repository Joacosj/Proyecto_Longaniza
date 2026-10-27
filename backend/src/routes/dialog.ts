import type { Hono } from "hono";
import type { StageKind } from "../contracts/artifacts.ts";
import type { GeneratableStage } from "../engine/types.ts";
import { isUuid, type ProjectEnv, requireProjectRole } from "../auth/roles.ts";
import { readJsonObject, Validator } from "../http/body.ts";
import { ApiError } from "../http/errors.ts";
import { auditRepo } from "../repositories/audit.ts";
import { buildProjectContext } from "../repositories/context.ts";
import { messagesRepo } from "../repositories/messages.ts";
import { type Question, questionsRepo } from "../repositories/questions.ts";
import { isStageKind, stagesRepo } from "../repositories/stages.ts";
import { inTransaction } from "../repositories/tx.ts";
import type { StageDeps } from "./stages.ts";

export const MAX_MESSAGE = 10_000;
export const MAX_ANSWER = 5_000;

/** Lee `?stage=`: ausente → undefined; inválido → 400. */
function stageQuery(value: string | undefined): StageKind | undefined {
  if (value === undefined || value === "") return undefined;
  if (!isStageKind(value)) throw new ApiError("BAD_REQUEST", "Parámetro stage inválido");
  return value;
}

/** Rutas de diálogo con la IA y de preguntas, dentro de un proyecto. */
export function registerDialogRoutes(r: Hono<ProjectEnv>, deps: StageDeps) {
  r.get("/:id/messages", requireProjectRole(deps, "viewer"), async (c) => {
    const stage = stageQuery(c.req.query("stage"));
    return c.json({ messages: await messagesRepo(deps.sql).list(c.get("projectId"), stage) });
  });

  r.post("/:id/messages", requireProjectRole(deps, "editor"), async (c) => {
    const projectId = c.get("projectId");
    const user = c.get("user");
    const body = await readJsonObject(c);
    const v = new Validator(body);
    const stageRaw = v.string("stage", { min: 1 });
    if (stageRaw && (!isStageKind(stageRaw) || stageRaw === "review")) {
      v.fail("stage", "Debe ser una etapa con contenido (no review)");
    }
    const content = v.string("content", { min: 1, max: MAX_MESSAGE });
    v.done();
    const stage = stageRaw as GeneratableStage;

    const current = await stagesRepo(deps.sql).get(projectId, stage);
    if (current?.status === "locked") {
      throw new ApiError("CONFLICT", "La etapa está bloqueada: aprueba primero la anterior");
    }

    const messages = messagesRepo(deps.sql);
    const history = (await messages.list(projectId, stage)).map((m) => ({
      role: m.role,
      content: m.content,
    }));
    // El mensaje del usuario se guarda antes de llamar a la IA: si la IA falla, no se pierde.
    const message = await messages.add({
      projectId,
      stage,
      role: "user",
      content,
      userId: user.id,
    });

    const context = await buildProjectContext(deps.sql, projectId);
    const result = await deps.engine.converse({ context, stage, history, userMessage: content });

    const saved = await inTransaction(deps.sql, async (tx) => {
      const reply = await messagesRepo(tx).add({
        projectId,
        stage,
        role: "assistant",
        content: result.reply,
        userId: null,
      });
      const questions = await questionsRepo(tx).insertMany(projectId, stage, result.newQuestions);
      return { reply, questions };
    });

    return c.json({
      message,
      reply: saved.reply,
      questions: saved.questions,
      // Borrador sugerido por la IA. No se guarda: la interfaz lo aplica con PUT /stages/:kind.
      artifactDraft: result.artifactDraft ?? null,
    }, 201);
  });

  r.get("/:id/questions", requireProjectRole(deps, "viewer"), async (c) => {
    const statusQ = c.req.query("status");
    if (statusQ && !["open", "answered", "deferred"].includes(statusQ)) {
      throw new ApiError("BAD_REQUEST", "Parámetro status inválido");
    }
    const blockingQ = c.req.query("blocking");
    if (blockingQ && blockingQ !== "true" && blockingQ !== "false") {
      throw new ApiError("BAD_REQUEST", "Parámetro blocking inválido (true o false)");
    }
    const questions = await questionsRepo(deps.sql).list(c.get("projectId"), {
      stage: stageQuery(c.req.query("stage")),
      status: (statusQ || undefined) as Question["status"] | undefined,
      blocking: blockingQ ? blockingQ === "true" : undefined,
    });
    return c.json({ questions });
  });

  r.patch("/:id/questions/:questionId", requireProjectRole(deps, "editor"), async (c) => {
    const projectId = c.get("projectId");
    const questionId = c.req.param("questionId");
    const body = await readJsonObject(c);
    const v = new Validator(body);

    // { answer } o { status: "answered", answer } responde; { status: "deferred" } pospone;
    // { status: "open" } la reabre.
    const status = body.status ?? (body.answer !== undefined ? "answered" : undefined);
    if (status !== "answered" && status !== "deferred" && status !== "open") {
      v.fail("status", "Debe ser answered, deferred u open");
    }
    const answer = status === "answered" ? v.string("answer", { min: 1, max: MAX_ANSWER }) : "";
    v.done();

    const question = await inTransaction(deps.sql, async (tx) => {
      const questions = questionsRepo(tx);
      const q = isUuid(questionId) ? await questions.find(projectId, questionId) : undefined;
      if (!q) throw new ApiError("NOT_FOUND", "La pregunta no existe en este proyecto");
      if (status === "deferred" && q.isBlocking) {
        throw new ApiError("CONFLICT", "Una pregunta bloqueante no se puede posponer: respóndela");
      }

      if (status === "answered") await questions.answer(q.id, answer, c.get("user").id);
      else await questions.setStatus(q.id, status as "open" | "deferred");

      await auditRepo(tx).log({
        projectId,
        userId: c.get("user").id,
        action: status === "answered"
          ? "question.answered"
          : status === "deferred"
          ? "question.deferred"
          : "question.reopened",
        entityType: "question",
        entityId: q.id,
        detail: { stage: q.stageKind, isBlocking: q.isBlocking },
      });
      return (await questions.find(projectId, q.id))!;
    });

    return c.json({ question });
  });
}
