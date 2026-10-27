import assert from "node:assert/strict";
import { buildApp, TestClient } from "./helpers/app.ts";
import { createTestDb } from "./helpers/db.ts";

Deno.test("A2: proyectos y permisos", async (t) => {
  const db = await createTestDb();
  const app = buildApp({ sql: db.sql });

  const ana = new TestClient(app);
  const beto = new TestClient(app);
  const carla = new TestClient(app);
  const anon = new TestClient(app);

  try {
    const anaUser = await ana.register("ana@example.com", "Ana");
    const betoUser = await beto.register("beto@example.com", "Beto");
    const carlaUser = await carla.register("carla@example.com", "Carla");

    /** Agrega un miembro directo en la base (las rutas de miembros son de A3). */
    const addMember = (projectId: string, userId: string, role: string) =>
      db.sql`INSERT INTO project_members (project_id, user_id, role)
             VALUES (${projectId}, ${userId}, ${role})`;

    const createProject = async (client: TestClient, name: string) => {
      const res = await client.post("/api/projects", { name, initialIdea: `Idea de ${name}` });
      assert.equal(res.status, 201);
      return (await res.json()).project as { id: string; name: string; role: string };
    };

    let anaProject: { id: string };

    await t.step("sin sesión, todas las rutas de proyectos responden 401", async () => {
      assert.equal((await anon.get("/api/projects")).status, 401);
      assert.equal((await anon.post("/api/projects", { name: "x", initialIdea: "y" })).status, 401);
      const someId = crypto.randomUUID();
      assert.equal((await anon.get(`/api/projects/${someId}`)).status, 401);
      assert.equal((await anon.delete(`/api/projects/${someId}`)).status, 401);
    });

    await t.step("crear deja al creador como owner y las seis etapas", async () => {
      const res = await ana.post("/api/projects", {
        name: "  Reportes vecinales ",
        initialIdea: "Una app para reportar baches",
      });
      assert.equal(res.status, 201);
      const { project } = await res.json();
      anaProject = project;
      assert.equal(project.name, "Reportes vecinales");
      assert.equal(project.initialIdea, "Una app para reportar baches");
      assert.equal(project.role, "owner");
      assert.equal(project.currentStage, "definition");
      assert.equal(project.status, "in_progress");

      const members = await db.sql`
        SELECT user_id, role FROM project_members WHERE project_id = ${project.id}`;
      assert.deepEqual(members.map((m) => [m.user_id, m.role]), [[anaUser.id, "owner"]]);

      const stages = await db.sql`
        SELECT kind, status, version FROM stages WHERE project_id = ${project.id}`;
      const byKind = Object.fromEntries(stages.map((s) => [s.kind, s.status]));
      assert.deepEqual(byKind, {
        definition: "in_progress",
        database: "locked",
        backend: "locked",
        frontend: "locked",
        architecture: "locked",
        review: "locked",
      });
      assert.ok(stages.every((s) => s.version === 1));
    });

    await t.step("crear con datos inválidos responde 422", async () => {
      const res = await ana.post("/api/projects", { name: "", initialIdea: 42 });
      assert.equal(res.status, 422);
      const fields = (await res.json()).error.details.fields;
      assert.ok(fields.name);
      assert.ok(fields.initialIdea);
    });

    await t.step("el listado solo muestra los proyectos propios", async () => {
      await createProject(beto, "Proyecto de Beto");

      const anaList = (await (await ana.get("/api/projects")).json()).projects;
      assert.deepEqual(anaList.map((p: { name: string }) => p.name), ["Reportes vecinales"]);

      const betoList = (await (await beto.get("/api/projects")).json()).projects;
      assert.deepEqual(betoList.map((p: { name: string }) => p.name), ["Proyecto de Beto"]);
    });

    await t.step("un proyecto ajeno responde 403 al pedirlo por id", async () => {
      const res = await beto.get(`/api/projects/${anaProject.id}`);
      assert.equal(res.status, 403);
      assert.equal((await res.json()).error.code, "FORBIDDEN");
    });

    await t.step("un id que no existe también responde 403 (no revela existencia)", async () => {
      const res = await ana.get(`/api/projects/${crypto.randomUUID()}`);
      assert.equal(res.status, 403);
    });

    await t.step("un id con formato inválido responde 400", async () => {
      const res = await ana.get("/api/projects/no-es-uuid");
      assert.equal(res.status, 400);
    });

    await t.step("un ajeno tampoco puede editar ni borrar", async () => {
      const patch = await beto.patch(`/api/projects/${anaProject.id}`, { name: "Robado" });
      assert.equal(patch.status, 403);
      assert.equal((await beto.delete(`/api/projects/${anaProject.id}`)).status, 403);
      const [p] = await db.sql`SELECT name FROM projects WHERE id = ${anaProject.id}`;
      assert.equal(p.name, "Reportes vecinales");
    });

    await t.step("un viewer ve el proyecto con su rol, pero no puede editarlo", async () => {
      await addMember(anaProject.id, carlaUser.id, "viewer");

      const res = await carla.get(`/api/projects/${anaProject.id}`);
      assert.equal(res.status, 200);
      assert.equal((await res.json()).project.role, "viewer");

      const list = (await (await carla.get("/api/projects")).json()).projects;
      assert.equal(list.length, 1);
      assert.equal(list[0].role, "viewer");

      assert.equal(
        (await carla.patch(`/api/projects/${anaProject.id}`, { name: "x" })).status,
        403,
      );
      assert.equal((await carla.delete(`/api/projects/${anaProject.id}`)).status, 403);
    });

    await t.step("un editor tampoco puede editar ni borrar el proyecto (solo owner)", async () => {
      await addMember(anaProject.id, betoUser.id, "editor");
      assert.equal((await beto.get(`/api/projects/${anaProject.id}`)).status, 200);
      assert.equal((await beto.patch(`/api/projects/${anaProject.id}`, { name: "x" })).status, 403);
      assert.equal((await beto.delete(`/api/projects/${anaProject.id}`)).status, 403);
    });

    await t.step("el owner edita nombre e idea", async () => {
      const res = await ana.patch(`/api/projects/${anaProject.id}`, {
        name: "Reportes del barrio",
        initialIdea: "Reportar baches y luminarias",
      });
      assert.equal(res.status, 200);
      const { project } = await res.json();
      assert.equal(project.name, "Reportes del barrio");
      assert.equal(project.initialIdea, "Reportar baches y luminarias");
      assert.equal(project.role, "owner");
    });

    await t.step("PATCH sin campos o con campos inválidos responde 422", async () => {
      assert.equal((await ana.patch(`/api/projects/${anaProject.id}`, {})).status, 422);
      assert.equal((await ana.patch(`/api/projects/${anaProject.id}`, { name: "" })).status, 422);
    });

    await t.step("la auditoría registra creación y edición, visible para miembros", async () => {
      const res = await carla.get(`/api/projects/${anaProject.id}/audit`);
      assert.equal(res.status, 200);
      const { entries } = await res.json();
      assert.deepEqual(entries.map((e: { action: string }) => e.action), [
        "project.updated",
        "project.created",
      ]);
      assert.equal(entries[0].user.name, "Ana");
      assert.deepEqual(entries[0].detail.fields, ["name", "initialIdea"]);

      const outsider = new TestClient(app);
      await outsider.register("dani@example.com", "Dani");
      assert.equal((await outsider.get(`/api/projects/${anaProject.id}/audit`)).status, 403);
    });

    await t.step("el owner borra el proyecto: 204, cascada y auditoría", async () => {
      const res = await ana.delete(`/api/projects/${anaProject.id}`);
      assert.equal(res.status, 204);

      const left = await db.sql`
        SELECT (SELECT count(*) FROM projects WHERE id = ${anaProject.id})::int AS p,
               (SELECT count(*) FROM stages WHERE project_id = ${anaProject.id})::int AS s,
               (SELECT count(*) FROM project_members WHERE project_id = ${anaProject.id})::int AS m`;
      assert.deepEqual({ ...left[0] }, { p: 0, s: 0, m: 0 });

      const [log] = await db.sql`
        SELECT user_id, project_id, detail FROM audit_log
        WHERE action = 'project.deleted' AND entity_id = ${anaProject.id}`;
      assert.equal(log.user_id, anaUser.id);
      assert.equal(log.project_id, null);
      assert.equal(log.detail.name, "Reportes del barrio");

      // Los ex miembros ya no lo ven.
      assert.equal((await beto.get(`/api/projects/${anaProject.id}`)).status, 403);
      const carlaList = (await (await carla.get("/api/projects")).json()).projects;
      assert.equal(carlaList.length, 0);
    });
  } finally {
    await db.close();
  }
});
