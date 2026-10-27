import assert from "node:assert/strict";
import { createFakeEngine } from "../src/engine/fake.ts";
import type { ChatMessage, Engine, Inconsistency } from "../src/engine/types.ts";
import { buildApp, joinProject, TestClient } from "./helpers/app.ts";
import { createTestDb } from "./helpers/db.ts";

/**
 * Motor falso con dos controles para las pruebas: registra el historial que recibe
 * `converse` y permite forzar lo que reporta el validador de consistencia.
 */
function controlledEngine() {
  const fake = createFakeEngine();
  const state = {
    histories: [] as ChatMessage[][],
    /** null = usar el validador real. */
    inconsistencies: null as Inconsistency[] | null,
  };
  const engine: Engine = {
    ...fake,
    converse: (input) => {
      state.histories.push(structuredClone(input.history));
      return fake.converse(input);
    },
    checkConsistency: (ctx) => state.inconsistencies ?? fake.checkConsistency(ctx),
  };
  return { engine, state };
}

Deno.test("A5: diálogo, preguntas, revisión y documentos", async (t) => {
  const db = await createTestDb();
  const { engine, state } = controlledEngine();
  const app = buildApp({ sql: db.sql, engine });

  const ana = new TestClient(app); // owner
  const beto = new TestClient(app); // editor
  const carla = new TestClient(app); // viewer
  const dani = new TestClient(app); // ajena

  try {
    await ana.register("ana@example.com", "Ana");
    const betoUser = await beto.register("beto@example.com", "Beto");
    const carlaUser = await carla.register("carla@example.com", "Carla");
    await dani.register("dani@example.com", "Dani");

    const created = await ana.post("/api/projects", { name: "Salas", initialIdea: "Reservas" });
    const projectId = (await created.json()).project.id as string;
    await joinProject(ana, beto, betoUser.email, projectId, "editor");
    await joinProject(ana, carla, carlaUser.email, projectId, "viewer");
    const base = `/api/projects/${projectId}`;

    const openBlocking = async () =>
      (await (await ana.get(`${base}/questions?status=open&blocking=true`)).json())
        .questions as { id: string; text: string }[];

    await t.step("GET /architectures exige sesión y lista las cinco", async () => {
      assert.equal((await new TestClient(app).get("/api/architectures")).status, 401);
      const res = await dani.get("/api/architectures");
      assert.equal(res.status, 200);
      assert.equal((await res.json()).architectures.length, 5);
    });

    await t.step("POST /messages valida rol, etapa y contenido", async () => {
      const ok = { stage: "definition", content: "Hola" };
      assert.equal((await carla.post(`${base}/messages`, ok)).status, 403);
      assert.equal((await dani.post(`${base}/messages`, ok)).status, 403);
      assert.equal(
        (await beto.post(`${base}/messages`, { stage: "review", content: "x" })).status,
        422,
      );
      assert.equal(
        (await beto.post(`${base}/messages`, { stage: "definition", content: " " })).status,
        422,
      );
      const locked = await beto.post(`${base}/messages`, { stage: "database", content: "x" });
      assert.equal(locked.status, 409);
    });

    await t.step("POST /messages guarda ambos mensajes y las preguntas detectadas", async () => {
      const res = await beto.post(`${base}/messages`, {
        stage: "definition",
        content: "Quiero reservar salas de estudio",
      });
      assert.equal(res.status, 201);
      const body = await res.json();
      assert.equal(body.message.role, "user");
      assert.equal(body.message.user.name, "Beto");
      assert.equal(body.message.content, "Quiero reservar salas de estudio");
      assert.equal(body.reply.role, "assistant");
      assert.equal(body.reply.user, null);
      assert.match(body.reply.content, /Quiero reservar salas/);
      assert.equal(body.questions.length, 1);
      assert.equal(body.questions[0].isBlocking, true);
      assert.equal(body.questions[0].stageKind, "definition");
      assert.equal(body.artifactDraft, null);
      assert.deepEqual(state.histories.at(-1), []);
    });

    await t.step("el segundo turno recibe el historial previo de la etapa", async () => {
      await ana.post(`${base}/messages`, { stage: "definition", content: "Segundo" });
      const history = state.histories.at(-1)!;
      assert.deepEqual(history.map((m) => m.role), ["user", "assistant"]);
      assert.equal(history[0].content, "Quiero reservar salas de estudio");
    });

    await t.step("GET /messages lista en orden y filtra por etapa", async () => {
      const res = await carla.get(`${base}/messages?stage=definition`);
      assert.equal(res.status, 200);
      const { messages } = await res.json();
      assert.deepEqual(messages.map((m: { role: string }) => m.role), [
        "user",
        "assistant",
        "user",
        "assistant",
      ]);
      const other = (await (await carla.get(`${base}/messages?stage=database`)).json()).messages;
      assert.equal(other.length, 0);
      assert.equal((await carla.get(`${base}/messages?stage=nope`)).status, 400);
      assert.equal((await dani.get(`${base}/messages`)).status, 403);
    });

    await t.step("GET /questions filtra por estado y bloqueo", async () => {
      assert.equal((await openBlocking()).length, 2);
      const answered = await (await carla.get(`${base}/questions?status=answered`)).json();
      assert.equal(answered.questions.length, 0);
      assert.equal((await carla.get(`${base}/questions?blocking=quizas`)).status, 400);
      assert.equal((await carla.get(`${base}/questions?status=cerrada`)).status, 400);
    });

    await t.step("posponer una bloqueante responde 409; responderla funciona", async () => {
      const [q] = await openBlocking();
      const defer = await beto.patch(`${base}/questions/${q.id}`, { status: "deferred" });
      assert.equal(defer.status, 409);

      assert.equal((await carla.patch(`${base}/questions/${q.id}`, { answer: "No" })).status, 403);
      assert.equal((await beto.patch(`${base}/questions/${q.id}`, { answer: "" })).status, 422);

      const res = await beto.patch(`${base}/questions/${q.id}`, { answer: "Sí, anónimos" });
      assert.equal(res.status, 200);
      const { question } = await res.json();
      assert.equal(question.status, "answered");
      assert.equal(question.answer, "Sí, anónimos");
      assert.equal(question.answeredBy.name, "Beto");
      assert.equal((await openBlocking()).length, 1);
    });

    await t.step("una no bloqueante se puede posponer y reabrir", async () => {
      const [q] = await db.sql`
        INSERT INTO questions (project_id, stage_kind, text, rationale)
        VALUES (${projectId}, 'definition', '¿Colores?', 'Estética') RETURNING id`;
      const deferred = await beto.patch(`${base}/questions/${q.id}`, { status: "deferred" });
      assert.equal(deferred.status, 200);
      assert.equal((await deferred.json()).question.status, "deferred");
      const reopened = await beto.patch(`${base}/questions/${q.id}`, { status: "open" });
      assert.equal((await reopened.json()).question.status, "open");
    });

    await t.step("una pregunta inexistente responde 404; estado inválido, 422", async () => {
      const res = await beto.patch(`${base}/questions/${crypto.randomUUID()}`, { answer: "x" });
      assert.equal(res.status, 404);
      assert.equal((await beto.patch(`${base}/questions/abc`, { answer: "x" })).status, 404);
      const [q] = await openBlocking();
      assert.equal((await beto.patch(`${base}/questions/${q.id}`, { status: "x" })).status, 422);
    });

    await t.step("POST /documents con pendientes responde 409 con la lista", async () => {
      const res = await beto.post(`${base}/documents`);
      assert.equal(res.status, 409);
      const { pending } = (await res.json()).error.details;
      assert.deepEqual(pending.unapprovedStages, [
        "definition",
        "database",
        "backend",
        "frontend",
        "architecture",
      ]);
      assert.equal(pending.blockingQuestions.length, 1);
      assert.deepEqual(pending.criticalInconsistencies, []);
    });

    await t.step("GET /review resume etapas y pendientes", async () => {
      const res = await carla.get(`${base}/review`);
      assert.equal(res.status, 200);
      const review = await res.json();
      assert.equal(review.stages.length, 6);
      assert.equal(review.canGenerateDocuments, false);
      assert.equal(review.pending.blockingQuestions.length, 1);
      assert.deepEqual(review.documents, []);
      assert.equal((await dani.get(`${base}/review`)).status, 403);
    });

    await t.step("se completan las cinco etapas: genera, responde y aprueba", async () => {
      for (const q of await openBlocking()) {
        await beto.patch(`${base}/questions/${q.id}`, { answer: "Respuesta" });
      }
      for (const kind of ["definition", "database", "backend", "frontend", "architecture"]) {
        const gen = await beto.post(`${base}/stages/${kind}/generate`);
        assert.equal(gen.status, 200, `generar ${kind}`);
        const { stage } = await gen.json();
        const ok = await beto.post(`${base}/stages/${kind}/approve`, { version: stage.version });
        assert.equal(ok.status, 200, `aprobar ${kind}: ${await ok.clone().text()}`);
      }
      const review = await (await carla.get(`${base}/review`)).json();
      assert.deepEqual(review.pending.unapprovedStages, []);
    });

    await t.step("consistency-check guarda las críticas y bloquea los documentos", async () => {
      assert.equal((await carla.post(`${base}/consistency-check`)).status, 403);

      state.inconsistencies = [{
        stages: ["database", "backend"],
        description: "El endpoint EP-1 usa una entidad que no existe",
        severity: "critical",
      }];
      const res = await beto.post(`${base}/consistency-check`);
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.added, 1);
      assert.equal(body.inconsistencies.length, 1);
      assert.equal(body.inconsistencies[0].severity, "critical");

      const review = await (await carla.get(`${base}/review`)).json();
      assert.equal(review.canGenerateDocuments, false);
      assert.equal(review.pending.criticalInconsistencies.length, 1);

      const docs = await beto.post(`${base}/documents`);
      assert.equal(docs.status, 409);
      const { pending } = (await docs.json()).error.details;
      assert.equal(pending.criticalInconsistencies.length, 1);
    });

    await t.step("repetir el chequeo no duplica las inconsistencias abiertas", async () => {
      const body = await (await beto.post(`${base}/consistency-check`)).json();
      assert.equal(body.added, 0);
      assert.equal(body.inconsistencies.length, 1);
    });

    await t.step("PATCH /inconsistencies la marca resuelta y no vuelve a abrirse", async () => {
      const { inconsistencies } = await (await carla.get(`${base}/review`)).json();
      const inc = inconsistencies[0];

      assert.equal(
        (await carla.patch(`${base}/inconsistencies/${inc.id}`, { status: "resolved" })).status,
        403,
      );
      assert.equal((await beto.patch(`${base}/inconsistencies/${inc.id}`, {})).status, 422);
      const missing = await beto.patch(`${base}/inconsistencies/${crypto.randomUUID()}`, {
        status: "resolved",
      });
      assert.equal(missing.status, 404);

      const res = await beto.patch(`${base}/inconsistencies/${inc.id}`, { status: "resolved" });
      assert.equal(res.status, 200);
      const { inconsistency } = await res.json();
      assert.equal(inconsistency.status, "resolved");
      assert.equal(inconsistency.resolvedBy.name, "Beto");

      // El validador la sigue reportando, pero la decisión del equipo se respeta.
      const again = await (await beto.post(`${base}/consistency-check`)).json();
      assert.equal(again.added, 0);
      assert.equal(again.inconsistencies.length, 0);
    });

    await t.step("POST /documents genera los dos Markdown (201)", async () => {
      assert.equal((await carla.post(`${base}/documents`)).status, 403);

      const res = await beto.post(`${base}/documents`);
      assert.equal(res.status, 201, await res.clone().text());
      const body = await res.json();
      assert.equal(body.version, 1);
      assert.deepEqual(body.documents.map((d: { kind: string }) => d.kind).sort(), [
        "architecture",
        "product_spec",
      ]);
      const project = (await (await carla.get(base)).json()).project;
      assert.equal(project.status, "generated");
    });

    await t.step("GET /documents lista versiones; /documents/:kind descarga Markdown", async () => {
      const list = (await (await carla.get(`${base}/documents`)).json()).documents;
      assert.equal(list.length, 2);
      assert.equal(list[0].generatedBy.name, "Beto");

      const res = await carla.get(`${base}/documents/product_spec`);
      assert.equal(res.status, 200);
      assert.match(res.headers.get("content-type")!, /^text\/markdown/);
      assert.match(
        res.headers.get("content-disposition")!,
        /attachment; filename="especificacion-producto-v1\.md"/,
      );
      const md = await res.text();
      assert.match(md, /^# /);
      assert.match(md, /Salas/);

      const arch = await carla.get(`${base}/documents/architecture`);
      assert.equal(arch.status, 200);
      assert.ok((await arch.text()).length > 100);

      assert.equal((await carla.get(`${base}/documents/otro`)).status, 404);
      assert.equal((await carla.get(`${base}/documents/product_spec?version=9`)).status, 404);
      assert.equal((await carla.get(`${base}/documents/product_spec?version=x`)).status, 400);
      assert.equal((await dani.get(`${base}/documents/product_spec`)).status, 403);
    });

    await t.step("generar otra vez crea la versión 2 y conserva la 1", async () => {
      const res = await ana.post(`${base}/documents`);
      assert.equal((await res.json()).version, 2);
      const v1 = await carla.get(`${base}/documents/architecture?version=1`);
      assert.match(v1.headers.get("content-disposition")!, /arquitectura-v1\.md/);
      const latest = await carla.get(`${base}/documents/architecture`);
      assert.match(latest.headers.get("content-disposition")!, /arquitectura-v2\.md/);
    });

    await t.step(
      "si el validador deja de reportar una inconsistencia, se cierra sola",
      async () => {
        state.inconsistencies = [{
          stages: ["frontend"],
          description: "Pantalla sin acciones",
          severity: "warning",
        }];
        assert.equal((await (await beto.post(`${base}/consistency-check`)).json()).added, 1);

        state.inconsistencies = [];
        const body = await (await beto.post(`${base}/consistency-check`)).json();
        assert.equal(body.autoResolved, 1);
        assert.equal(body.inconsistencies.length, 0);
      },
    );

    await t.step("la auditoría registra preguntas, chequeos y documentos", async () => {
      const { entries } = await (await carla.get(`${base}/audit`)).json();
      const actions = new Set(entries.map((e: { action: string }) => e.action));
      for (
        const a of [
          "question.answered",
          "question.deferred",
          "question.reopened",
          "consistency.checked",
          "inconsistency.resolved",
          "documents.generated",
        ]
      ) {
        assert.ok(actions.has(a), `falta ${a}`);
      }
    });
  } finally {
    await db.close();
  }
});
