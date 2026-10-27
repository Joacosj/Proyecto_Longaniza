import { Hono } from "hono";
import { requireUser } from "../auth/session.ts";
import type { AuthDeps } from "../auth/session.ts";
import { type ProjectEnv, requireProjectRole } from "../auth/roles.ts";
import type { Sql } from "../db/client.ts";
import { readJsonObject, Validator } from "../http/body.ts";
import { ApiError } from "../http/errors.ts";
import { auditRepo } from "../repositories/audit.ts";
import { projectsRepo } from "../repositories/projects.ts";

export const MAX_NAME = 120;
export const MAX_IDEA = 10_000;

export function projectRoutes(deps: AuthDeps) {
  const r = new Hono<ProjectEnv>();
  const projects = projectsRepo(deps.sql);

  r.use("*", requireUser(deps));

  r.get("/", async (c) => {
    return c.json({ projects: await projects.listForUser(c.get("user").id) });
  });

  r.post("/", async (c) => {
    const v = new Validator(await readJsonObject(c));
    const name = v.string("name", { min: 1, max: MAX_NAME });
    const initialIdea = v.string("initialIdea", { min: 1, max: MAX_IDEA });
    v.done();

    const userId = c.get("user").id;
    const project = await deps.sql.begin(async (tx) => {
      const db = tx as unknown as Sql;
      const created = await projectsRepo(db).create({ name, initialIdea, userId });
      await auditRepo(db).log({
        projectId: created.id,
        userId,
        action: "project.created",
        entityType: "project",
        entityId: created.id,
        detail: { name },
      });
      return created;
    });

    return c.json({ project: { ...project, role: "owner" } }, 201);
  });

  r.get("/:id", requireProjectRole(deps, "viewer"), async (c) => {
    const project = await projects.findForUser(c.get("projectId"), c.get("user").id);
    return c.json({ project });
  });

  r.patch("/:id", requireProjectRole(deps, "owner"), async (c) => {
    const body = await readJsonObject(c);
    const v = new Validator(body);
    const changes: { name?: string; initialIdea?: string } = {};
    if ("name" in body) changes.name = v.string("name", { min: 1, max: MAX_NAME });
    if ("initialIdea" in body) {
      changes.initialIdea = v.string("initialIdea", { min: 1, max: MAX_IDEA });
    }
    if (Object.keys(changes).length === 0) {
      v.fail("name", "Indica al menos name o initialIdea");
    }
    v.done();

    const projectId = c.get("projectId");
    const user = c.get("user");
    const updated = await deps.sql.begin(async (tx) => {
      const db = tx as unknown as Sql;
      const row = await projectsRepo(db).update(projectId, changes);
      await auditRepo(db).log({
        projectId,
        userId: user.id,
        action: "project.updated",
        entityType: "project",
        entityId: projectId,
        detail: { fields: Object.keys(changes) },
      });
      return row;
    });

    return c.json({ project: { ...updated, role: c.get("projectRole") } });
  });

  r.delete("/:id", requireProjectRole(deps, "owner"), async (c) => {
    const projectId = c.get("projectId");
    const user = c.get("user");
    await deps.sql.begin(async (tx) => {
      const db = tx as unknown as Sql;
      const deleted = await projectsRepo(db).delete(projectId);
      if (!deleted) throw new ApiError("NOT_FOUND", "El proyecto ya no existe");
      // project_id queda NULL: con el proyecto borrado, una fila ligada a él se borraría
      // en cascada. El id queda en entity_id para la trazabilidad.
      await auditRepo(db).log({
        projectId: null,
        userId: user.id,
        action: "project.deleted",
        entityType: "project",
        entityId: projectId,
        detail: { name: deleted.name },
      });
    });
    return c.body(null, 204);
  });

  r.get("/:id/audit", requireProjectRole(deps, "viewer"), async (c) => {
    return c.json({ entries: await auditRepo(deps.sql).listForProject(c.get("projectId")) });
  });

  return r;
}
