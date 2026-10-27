/**
 * A9. Prueba funcional del flujo completo.
 *
 * Levanta el backend como un servidor HTTP real (puerto libre) contra una base de prueba y
 * lo recorre como lo harían varias personas desde el navegador, con sus cookies:
 *
 *   registrarse → crear proyecto → invitar → el invitado edita → conflicto 409 →
 *   proyecto ajeno (403) → completar las etapas → revisar consistencia → generar documentos
 *
 * Usa el motor falso, cuyo validador de consistencia y generador de documentos son los
 * reales: así también verifica que el proyecto de ejemplo pasa el validador sin
 * inconsistencias críticas.
 *
 * Requiere la base arriba (docker compose up db).
 */
import assert from "node:assert/strict";
import { createApp } from "../../src/app.ts";
import { createFakeEngine } from "../../src/engine/fake.ts";
import { TEST_SECRET } from "../helpers/app.ts";
import { createTestDb } from "../helpers/db.ts";

/** Un "navegador": guarda la cookie de sesión y habla con el servidor por HTTP. */
class Browser {
  private cookie = "";
  constructor(private base: string, readonly name: string) {}

  async call(method: string, path: string, body?: unknown): Promise<Response> {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (this.cookie) headers["Cookie"] = this.cookie;
    const res = await fetch(`${this.base}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "manual",
    });
    for (const raw of res.headers.getSetCookie()) {
      const [pair] = raw.split(";");
      if (!pair.startsWith("ideator_session=")) continue;
      const expired = /max-age=0/i.test(raw) || /expires=Thu, 01 Jan 1970/i.test(raw);
      this.cookie = expired ? "" : pair;
    }
    return res;
  }

  /** Llama y exige el código esperado; devuelve el JSON (o el texto si no es JSON). */
  // Las respuestas se leen como JSON libre: cada paso valida los campos que le importan.
  // deno-lint-ignore no-explicit-any
  async expect<T = Record<string, any>>(
    status: number,
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const res = await this.call(method, path, body);
    const text = await res.text();
    assert.equal(
      res.status,
      status,
      `${this.name}: ${method} ${path} respondió ${res.status} (esperaba ${status}): ${text}`,
    );
    try {
      return JSON.parse(text);
    } catch {
      return text as T;
    }
  }

  get = (path: string, status = 200) => this.expect(status, "GET", path);
  post = (path: string, body?: unknown, status = 200) => this.expect(status, "POST", path, body);
  put = (path: string, body: unknown, status = 200) => this.expect(status, "PUT", path, body);
  patch = (path: string, body: unknown, status = 200) => this.expect(status, "PATCH", path, body);
}

const CONTENT_STAGES = ["definition", "database", "backend", "frontend", "architecture"] as const;

Deno.test("A9: flujo completo de un equipo, de la idea a los documentos", async (t) => {
  const db = await createTestDb();
  const app = createApp({
    pingDb: async () => {
      await db.sql`SELECT 1`;
    },
    sql: db.sql,
    sessionSecret: TEST_SECRET,
    engine: createFakeEngine(),
  });
  const server = Deno.serve({ port: 0, hostname: "127.0.0.1", onListen: () => {} }, app.fetch);
  const base = `http://127.0.0.1:${server.addr.port}/api`;

  const ana = new Browser(base, "Ana"); // crea el proyecto (owner)
  const beto = new Browser(base, "Beto"); // invitado como editor
  const carla = new Browser(base, "Carla"); // invitada como lectora
  const dani = new Browser(base, "Dani"); // no participa

  let projectId = "";
  const p = (path = "") => `/projects/${projectId}${path}`;

  try {
    await t.step("el servidor y la base responden", async () => {
      await ana.get("/health");
      await ana.get("/health/db");
    });

    await t.step("cuatro personas se registran; sin sesión no hay acceso", async () => {
      await ana.get("/auth/me", 401);
      await ana.post("/auth/register", {
        email: "ana@uai.cl",
        name: "Ana",
        password: "clave-ana-123",
      }, 201);
      await beto.post("/auth/register", {
        email: "beto@uai.cl",
        name: "Beto",
        password: "clave-beto-123",
      }, 201);
      await carla.post("/auth/register", {
        email: "carla@uai.cl",
        name: "Carla",
        password: "clave-carla-123",
      }, 201);
      await dani.post("/auth/register", {
        email: "dani@uai.cl",
        name: "Dani",
        password: "clave-dani-123",
      }, 201);
      assert.equal((await ana.get("/auth/me")).user.name, "Ana");
    });

    await t.step("Ana crea el proyecto: queda como owner con las seis etapas", async () => {
      const { project } = await ana.post("/projects", {
        name: "Reservas de salas",
        initialIdea: "Que los estudiantes reserven salas de estudio de la biblioteca.",
      }, 201);
      projectId = project.id;
      assert.equal(project.role, "owner");

      const { stages } = await ana.get(p("/stages"));
      assert.deepEqual(stages.map((s: { status: string }) => s.status), [
        "in_progress",
        "locked",
        "locked",
        "locked",
        "locked",
        "locked",
      ]);
    });

    await t.step("Ana invita a Beto (editor) y Carla (lectora); ambos aceptan", async () => {
      const toBeto = await ana.post(
        p("/invitations"),
        { email: "beto@uai.cl", role: "editor" },
        201,
      );
      const toCarla = await ana.post(
        p("/invitations"),
        { email: "carla@uai.cl", role: "viewer" },
        201,
      );

      // Dani no puede usar una invitación ajena.
      await dani.post(`/invitations/${toBeto.token}/accept`, undefined, 409);

      await beto.post(`/invitations/${toBeto.token}/accept`);
      await carla.post(`/invitations/${toCarla.token}/accept`);

      const { members } = await carla.get(p("/members"));
      assert.deepEqual(members.map((m: { name: string; role: string }) => `${m.name}:${m.role}`), [
        "Ana:owner",
        "Beto:editor",
        "Carla:viewer",
      ]);
    });

    await t.step("Dani no ve el proyecto: 403 en todo, aunque conozca el id", async () => {
      assert.equal((await dani.get("/projects")).projects.length, 0);
      await dani.get(p(), 403);
      await dani.get(p("/stages"), 403);
      await dani.get(p("/stages/definition"), 403);
      await dani.expect(403, "PUT", p("/stages/definition"), { version: 1, artifact: {} });
      await dani.post(p("/messages"), { stage: "definition", content: "hola" }, 403);
      await dani.post(p("/documents"), undefined, 403);
      await dani.expect(403, "DELETE", p());
      // Un id inventado responde igual: no revela si el proyecto existe.
      await dani.get(`/projects/${crypto.randomUUID()}`, 403);
    });

    await t.step("Beto conversa con la IA en la definición y aparece una bloqueante", async () => {
      const out = await beto.post(p("/messages"), {
        stage: "definition",
        content: "Los estudiantes reservan bloques de una hora en salas de la biblioteca.",
      }, 201);
      assert.equal(out.message.user.name, "Beto");
      assert.equal(out.reply.role, "assistant");
      assert.equal(out.questions.length, 1);
      assert.equal(out.questions[0].isBlocking, true);
    });

    await t.step("Beto genera la definición; no se aprueba con la bloqueante abierta", async () => {
      const { stage } = await beto.post(p("/stages/definition/generate"), { version: 1 });
      assert.equal(stage.version, 2);
      assert.ok(stage.artifact.problem, "la propuesta trae contenido");

      const blocked = await beto.post(p("/stages/definition/approve"), { version: 2 }, 409);
      assert.equal(blocked.error.details.blockingQuestions.length, 1);
    });

    await t.step(
      "Carla (lectora) no puede responder ni aprobar; Beto responde y aprueba",
      async () => {
        const { questions } = await carla.get(p("/questions?status=open&blocking=true"));
        const q = questions[0];
        await carla.patch(p(`/questions/${q.id}`), { answer: "Con su cuenta UAI" }, 403);
        await carla.post(p("/stages/definition/approve"), { version: 2 }, 403);

        // Posponer una bloqueante no está permitido: hay que responderla.
        await beto.patch(p(`/questions/${q.id}`), { status: "deferred" }, 409);
        await beto.patch(p(`/questions/${q.id}`), {
          answer: "Con su cuenta institucional (SSO UAI).",
        });

        const { stage } = await beto.post(p("/stages/definition/approve"), { version: 2 });
        assert.equal(stage.status, "approved");
        assert.equal(stage.approvedBy.name, "Beto");
        assert.equal((await carla.get(p("/stages/database"))).stage.status, "in_progress");
      },
    );

    await t.step(
      "conflicto: Ana y Beto editan la misma versión; el segundo recibe 409",
      async () => {
        const gen = await ana.post(p("/stages/database/generate"));
        const loaded = gen.stage.version;

        // Ambos tienen abierta la misma versión. Ana guarda primero.
        const anaDraft = { ...gen.stage.artifact, overview: "Versión de Ana" };
        const betoDraft = { ...gen.stage.artifact, overview: "Versión de Beto" };
        await ana.put(p("/stages/database"), { version: loaded, artifact: anaDraft });

        const conflict = await beto.put(p("/stages/database"), {
          version: loaded,
          artifact: betoDraft,
        }, 409);
        assert.equal(conflict.error.code, "CONFLICT");
        assert.deepEqual(conflict.error.details, { currentVersion: loaded + 1, updatedBy: "Ana" });

        // Nada se perdió: quedó lo de Ana.
        const { stage } = await beto.get(p("/stages/database"));
        assert.equal(stage.artifact.overview, "Versión de Ana");

        // Beto recarga, incorpora su cambio y guarda sobre la versión vigente.
        await beto.put(p("/stages/database"), {
          version: stage.version,
          artifact: { ...stage.artifact, overview: "Versión de Ana, revisada por Beto" },
        });
        const { versions } = await carla.get(p("/stages/database/versions"));
        assert.deepEqual(
          versions.map((v: { source: string; createdBy: { name: string } }) =>
            `${v.source}:${v.createdBy.name}`
          ),
          ["user:Beto", "user:Ana", "ai:Ana"],
        );
      },
    );

    await t.step("dos guardados simultáneos: uno gana y el otro recibe 409", async () => {
      const { stage } = await ana.get(p("/stages/database"));
      const [r1, r2] = await Promise.all([
        ana.call("PUT", p("/stages/database"), {
          version: stage.version,
          artifact: stage.artifact,
        }),
        beto.call("PUT", p("/stages/database"), {
          version: stage.version,
          artifact: stage.artifact,
        }),
      ]);
      assert.deepEqual([r1.status, r2.status].sort(), [200, 409]);
      await r1.body?.cancel();
      await r2.body?.cancel();
    });

    await t.step("el equipo completa y aprueba las demás etapas", async () => {
      const { stage: dbStage } = await beto.get(p("/stages/database"));
      await beto.post(p("/stages/database/approve"), { version: dbStage.version });

      for (const kind of ["backend", "frontend", "architecture"]) {
        const editor = kind === "frontend" ? ana : beto;
        const { stage } = await editor.post(p(`/stages/${kind}/generate`));
        await editor.post(p(`/stages/${kind}/approve`), { version: stage.version });
      }

      const { stages } = await carla.get(p("/stages"));
      const status = Object.fromEntries(
        stages.map((s: { kind: string; status: string }) => [s.kind, s.status]),
      );
      for (const k of CONTENT_STAGES) assert.equal(status[k], "approved", `${k} aprobada`);
      assert.equal((await carla.get(p())).project.status, "ready");
    });

    await t.step("el validador real no encuentra inconsistencias críticas", async () => {
      await carla.post(p("/consistency-check"), undefined, 403);
      const check = await beto.post(p("/consistency-check"));
      const critical = check.inconsistencies.filter((i: { severity: string }) =>
        i.severity === "critical"
      );
      assert.deepEqual(critical, [], "el proyecto de ejemplo debe ser coherente");

      const review = await carla.get(p("/review"));
      assert.equal(review.canGenerateDocuments, true);
      assert.deepEqual(review.pending, {
        unapprovedStages: [],
        blockingQuestions: [],
        criticalInconsistencies: [],
      });
    });

    await t.step("Beto genera los documentos; la lectora los descarga, Dani no", async () => {
      await carla.post(p("/documents"), undefined, 403);
      const out = await beto.post(p("/documents"), undefined, 201);
      assert.equal(out.version, 1);
      assert.equal((await ana.get(p())).project.status, "generated");

      const spec = await carla.call("GET", p("/documents/product_spec"));
      assert.equal(spec.status, 200);
      assert.match(spec.headers.get("content-type")!, /^text\/markdown/);
      assert.match(spec.headers.get("content-disposition")!, /especificacion-producto-v1\.md/);
      const specMd = await spec.text();
      assert.match(specMd, /^# .*Reservas de salas/m);
      assert.ok(specMd.length > 2000, "la especificación tiene contenido sustancial");

      const arch = await carla.call("GET", p("/documents/architecture"));
      assert.equal(arch.status, 200);
      assert.match(await arch.text(), /^# /m);

      const denied = await dani.call("GET", p("/documents/product_spec"));
      assert.equal(denied.status, 403);
      await denied.body?.cancel();
    });

    await t.step("editar una etapa aprobada vuelve a bloquear la generación", async () => {
      const { stage } = await ana.get(p("/stages/backend"));
      await ana.put(p("/stages/backend"), {
        version: stage.version,
        artifact: { ...stage.artifact, overview: `${stage.artifact.overview} (ajustado)` },
      });
      const review = await carla.get(p("/review"));
      assert.equal(review.canGenerateDocuments, false);
      assert.deepEqual(review.pending.unapprovedStages, ["backend", "frontend", "architecture"]);
      await beto.post(p("/documents"), undefined, 409);
    });

    await t.step("la auditoría cuenta la historia del proyecto", async () => {
      const { entries } = await carla.get(p("/audit"));
      const actions = new Set(entries.map((e: { action: string }) => e.action));
      for (
        const a of [
          "project.created",
          "invitation.created",
          "member.added",
          "stage.generated",
          "stage.updated",
          "stage.approved",
          "question.answered",
          "consistency.checked",
          "documents.generated",
        ]
      ) {
        assert.ok(actions.has(a), `falta ${a} en la auditoría`);
      }
    });

    await t.step("al cerrar sesión la cookie deja de servir", async () => {
      await ana.post("/auth/logout", undefined, 204);
      await ana.get("/auth/me", 401);
      await ana.get(p(), 401);
    });
  } finally {
    await server.shutdown();
    await db.close();
  }
});
