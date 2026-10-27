import assert from "node:assert/strict";
import { createFakeEngine } from "../src/engine/fake.ts";
import type { Engine, ProjectContext } from "../src/engine/types.ts";
import { buildApp, joinProject, TestClient } from "./helpers/app.ts";
import { createTestDb } from "./helpers/db.ts";

/** Motor falso que además registra el contexto recibido y propone una pregunta. */
function spyEngine() {
  const fake = createFakeEngine();
  const calls: { stage: string; context: ProjectContext }[] = [];
  const engine: Engine = {
    ...fake,
    generate: async (input) => {
      calls.push({ stage: input.stage, context: structuredClone(input.context) });
      const out = await fake.generate(input);
      return {
        ...out,
        questions: [{
          text: `¿Pregunta sobre ${input.stage}?`,
          rationale: "Prueba",
          affects: ["backend"],
          isBlocking: false,
        }],
      };
    },
  };
  return { engine, calls };
}

Deno.test("A4: rutas de etapas con concurrencia", async (t) => {
  const db = await createTestDb();
  const spy = spyEngine();
  const app = buildApp({ sql: db.sql, engine: spy.engine });

  const ana = new TestClient(app); // owner
  const beto = new TestClient(app); // editor
  const carla = new TestClient(app); // viewer
  const dani = new TestClient(app); // ajena

  try {
    await ana.register("ana@example.com", "Ana");
    const betoUser = await beto.register("beto@example.com", "Beto");
    const carlaUser = await carla.register("carla@example.com", "Carla");
    await dani.register("dani@example.com", "Dani");

    const created = await ana.post("/api/projects", { name: "Barrio", initialIdea: "Reportes" });
    const projectId = (await created.json()).project.id as string;
    await joinProject(ana, beto, betoUser.email, projectId, "editor");
    await joinProject(ana, carla, carlaUser.email, projectId, "viewer");

    const base = `/api/projects/${projectId}/stages`;
    const getStage = async (kind: string) =>
      (await (await ana.get(`${base}/${kind}`)).json()).stage;
    const statuses = async () =>
      Object.fromEntries(
        ((await (await ana.get(base)).json()).stages as { kind: string; status: string }[])
          .map((s) => [s.kind, s.status]),
      );
    const project = async () =>
      (await (await ana.get(`/api/projects/${projectId}`)).json()).project;

    await t.step("GET /stages lista las seis etapas en orden, sin artefacto", async () => {
      const res = await carla.get(base);
      assert.equal(res.status, 200);
      const { stages } = await res.json();
      assert.deepEqual(stages.map((s: { kind: string }) => s.kind), [
        "definition",
        "database",
        "backend",
        "frontend",
        "architecture",
        "review",
      ]);
      assert.equal(stages[0].status, "in_progress");
      assert.equal(stages[1].status, "locked");
      assert.equal(stages[0].artifact, undefined);
    });

    await t.step("GET /stages/:kind devuelve artefacto, estado y versión", async () => {
      const res = await carla.get(`${base}/definition`);
      assert.equal(res.status, 200);
      const { stage } = await res.json();
      assert.deepEqual(stage.artifact, {});
      assert.equal(stage.version, 1);
      assert.equal(stage.status, "in_progress");
      assert.equal(stage.id, undefined, "no expone el id interno");
    });

    await t.step("una etapa inexistente responde 404; un ajeno, 403", async () => {
      assert.equal((await ana.get(`${base}/no-existe`)).status, 404);
      assert.equal((await dani.get(base)).status, 403);
      assert.equal((await dani.get(`${base}/definition`)).status, 403);
    });

    await t.step("un viewer no puede editar, aprobar ni generar", async () => {
      const put = await carla.put(`${base}/definition`, { version: 1, artifact: { x: 1 } });
      assert.equal(put.status, 403);
      assert.equal((await carla.post(`${base}/definition/approve`, { version: 1 })).status, 403);
      assert.equal((await carla.post(`${base}/definition/generate`)).status, 403);
    });

    await t.step("PUT guarda, sube la versión y deja copia en el historial", async () => {
      const res = await beto.put(`${base}/definition`, {
        version: 1,
        artifact: { problem: { statement: "v2" } },
      });
      assert.equal(res.status, 200);
      const { stage } = await res.json();
      assert.equal(stage.version, 2);
      assert.equal(stage.updatedBy.name, "Beto");
      assert.deepEqual(stage.artifact, { problem: { statement: "v2" } });

      const { versions } = await (await carla.get(`${base}/definition/versions`)).json();
      assert.equal(versions.length, 1);
      assert.equal(versions[0].version, 2);
      assert.equal(versions[0].source, "user");
      assert.equal(versions[0].createdBy.name, "Beto");
      assert.deepEqual(versions[0].artifact, { problem: { statement: "v2" } });
    });

    await t.step("PUT con versión desactualizada responde 409 con versión y autor", async () => {
      const res = await ana.put(`${base}/definition`, { version: 1, artifact: { otra: true } });
      assert.equal(res.status, 409);
      const body = await res.json();
      assert.equal(body.error.code, "CONFLICT");
      assert.equal(body.error.message, "Otra persona modificó esta etapa");
      assert.deepEqual(body.error.details, { currentVersion: 2, updatedBy: "Beto" });
      assert.deepEqual((await getStage("definition")).artifact, { problem: { statement: "v2" } });
    });

    await t.step("dos guardados concurrentes: uno gana y el otro recibe 409", async () => {
      const [r1, r2] = await Promise.all([
        ana.put(`${base}/definition`, { version: 2, artifact: { autor: "Ana" } }),
        beto.put(`${base}/definition`, { version: 2, artifact: { autor: "Beto" } }),
      ]);
      assert.deepEqual([r1.status, r2.status].sort(), [200, 409]);

      const winner = r1.status === 200 ? "Ana" : "Beto";
      const loser = r1.status === 200 ? r2 : r1;
      assert.deepEqual((await loser.json()).error.details, {
        currentVersion: 3,
        updatedBy: winner,
      });

      const stage = await getStage("definition");
      assert.equal(stage.version, 3);
      assert.deepEqual(stage.artifact, { autor: winner });
      const { versions } = await (await ana.get(`${base}/definition/versions`)).json();
      assert.deepEqual(versions.map((v: { version: number }) => v.version), [3, 2]);
    });

    await t.step("PUT con datos inválidos responde 422", async () => {
      const res = await ana.put(`${base}/definition`, { artifact: [1, 2] });
      assert.equal(res.status, 422);
      const fields = (await res.json()).error.details.fields;
      assert.ok(fields.version);
      assert.ok(fields.artifact);
    });

    await t.step("no se edita ni genera una etapa bloqueada; review no se edita", async () => {
      assert.equal((await ana.put(`${base}/database`, { version: 1, artifact: {} })).status, 409);
      assert.equal((await ana.post(`${base}/database/generate`)).status, 409);
      assert.equal((await ana.put(`${base}/review`, { version: 1, artifact: {} })).status, 409);
      assert.equal((await ana.post(`${base}/review/generate`)).status, 409);
    });

    await t.step("generate propone el artefacto con la IA y guarda sus preguntas", async () => {
      const res = await beto.post(`${base}/definition/generate`, { version: 3 });
      assert.equal(res.status, 200);
      const { stage, questions } = await res.json();
      assert.equal(stage.version, 4);
      assert.ok(stage.artifact.problem.statement, "debe traer el artefacto del motor");
      assert.equal(questions.length, 1);
      assert.equal(questions[0].stageKind, "definition");
      assert.equal(questions[0].status, "open");

      const call = spy.calls.at(-1)!;
      assert.equal(call.stage, "definition");
      assert.equal(call.context.projectName, "Barrio");
      assert.equal(call.context.initialIdea, "Reportes");

      const { versions } = await (await ana.get(`${base}/definition/versions`)).json();
      assert.equal(versions[0].source, "ai");
      assert.equal(versions[0].createdBy.name, "Beto");
    });

    await t.step("generate con versión desactualizada responde 409", async () => {
      const res = await ana.post(`${base}/definition/generate`, { version: 3 });
      assert.equal(res.status, 409);
      assert.equal((await res.json()).error.details.currentVersion, 4);
    });

    await t.step("approve con preguntas bloqueantes abiertas responde 409", async () => {
      const [q] = await db.sql`
        INSERT INTO questions (project_id, stage_kind, text, rationale, is_blocking)
        VALUES (${projectId}, 'definition', '¿Anónimos?', 'Cambia permisos', true)
        RETURNING id`;
      const res = await ana.post(`${base}/definition/approve`, { version: 4 });
      assert.equal(res.status, 409);
      const body = await res.json();
      assert.deepEqual(body.error.details.blockingQuestions, [{ id: q.id, text: "¿Anónimos?" }]);
      assert.equal((await getStage("definition")).status, "in_progress");

      await db.sql`UPDATE questions SET status = 'answered', answer = 'No' WHERE id = ${q.id}`;
    });

    await t.step("approve con versión desactualizada responde 409", async () => {
      const res = await ana.post(`${base}/definition/approve`, { version: 3 });
      assert.equal(res.status, 409);
      assert.deepEqual((await res.json()).error.details, { currentVersion: 4, updatedBy: "Beto" });
    });

    await t.step("approve aprueba, sube la versión y desbloquea la siguiente", async () => {
      const res = await ana.post(`${base}/definition/approve`, { version: 4 });
      assert.equal(res.status, 200);
      const { stage } = await res.json();
      assert.equal(stage.status, "approved");
      assert.equal(stage.version, 5);
      assert.equal(stage.approvedBy.name, "Ana");

      assert.deepEqual(await statuses(), {
        definition: "approved",
        database: "in_progress",
        backend: "locked",
        frontend: "locked",
        architecture: "locked",
        review: "locked",
      });
      assert.equal((await project()).currentStage, "database");
    });

    await t.step("aprobar dos veces o una etapa vacía o bloqueada responde 409", async () => {
      assert.equal((await ana.post(`${base}/definition/approve`, { version: 5 })).status, 409);
      const empty = await ana.post(`${base}/database/approve`, { version: 1 });
      assert.equal(empty.status, 409);
      assert.match((await empty.json()).error.message, /vacía/);
      assert.equal((await ana.post(`${base}/backend/approve`, { version: 1 })).status, 409);
    });

    await t.step("generate usa como contexto las etapas anteriores y las respuestas", async () => {
      const res = await ana.post(`${base}/database/generate`);
      assert.equal(res.status, 200);
      const call = spy.calls.at(-1)!;
      assert.equal(call.stage, "database");
      assert.ok(call.context.stages.definition, "incluye la definición aprobada");
      assert.deepEqual(call.context.answeredQuestions, [
        { stage: "definition", text: "¿Anónimos?", answer: "No" },
      ]);
      assert.ok(
        call.context.openQuestions.some((q) => q.text === "¿Pregunta sobre definition?"),
      );

      const db1 = await getStage("database");
      assert.equal(
        (await ana.post(`${base}/database/approve`, { version: db1.version })).status,
        200,
      );
      assert.equal((await statuses()).backend, "in_progress");
    });

    await t.step("editar una etapa aprobada la reabre a ella y a las posteriores", async () => {
      const def = await getStage("definition");
      const res = await beto.put(`${base}/definition`, {
        version: def.version,
        artifact: { ...def.artifact, constraints: ["nueva"] },
      });
      assert.equal(res.status, 200);
      const { stage } = await res.json();
      assert.equal(stage.status, "in_progress");
      assert.equal(stage.approvedBy, null);

      assert.deepEqual(await statuses(), {
        definition: "in_progress",
        database: "in_progress",
        backend: "in_progress",
        frontend: "locked",
        architecture: "locked",
        review: "locked",
      });
      assert.equal((await project()).currentStage, "definition");

      // database no se puede aprobar mientras definition no vuelva a estar aprobada.
      const dbStage = await getStage("database");
      const blocked = await ana.post(`${base}/database/approve`, { version: dbStage.version });
      assert.equal(blocked.status, 409);
      assert.equal((await blocked.json()).error.details.pending, "definition");
    });

    await t.step("cada guardado y aprobación queda en la auditoría", async () => {
      const { entries } = await (await carla.get(`/api/projects/${projectId}/audit`)).json();
      const actions = entries.map((e: { action: string }) => e.action);
      for (const a of ["stage.updated", "stage.generated", "stage.approved"]) {
        assert.ok(actions.includes(a), `falta ${a}`);
      }
      const reopen = entries.find((e: { action: string; detail: { reopened: string[] } }) =>
        e.action === "stage.updated" && e.detail.reopened.length > 0
      );
      assert.deepEqual(reopen.detail.reopened, ["definition", "database"]);
    });
  } finally {
    await db.close();
  }
});
