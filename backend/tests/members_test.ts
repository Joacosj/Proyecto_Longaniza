import assert from "node:assert/strict";
import { buildApp, joinProject, TestClient } from "./helpers/app.ts";
import { createTestDb } from "./helpers/db.ts";

Deno.test("A3: miembros e invitaciones", async (t) => {
  const db = await createTestDb();
  const app = buildApp({ sql: db.sql });

  const ana = new TestClient(app); // owner
  const beto = new TestClient(app); // será editor
  const carla = new TestClient(app); // será viewer
  const dani = new TestClient(app); // ajena

  try {
    const anaUser = await ana.register("ana@example.com", "Ana");
    const betoUser = await beto.register("beto@example.com", "Beto");
    const carlaUser = await carla.register("carla@example.com", "Carla");
    await dani.register("dani@example.com", "Dani");

    const created = await ana.post("/api/projects", { name: "P", initialIdea: "Idea" });
    const projectId = (await created.json()).project.id as string;
    const base = `/api/projects/${projectId}`;

    await t.step("invitar responde 201 con un token que solo sirve una vez", async () => {
      const res = await ana.post(`${base}/invitations`, {
        email: "BETO@example.com",
        role: "editor",
      });
      assert.equal(res.status, 201);
      const body = await res.json();
      assert.equal(body.invitation.email, "beto@example.com");
      assert.equal(body.invitation.role, "editor");
      assert.equal(body.invitation.status, "pending");
      assert.ok(body.token.length >= 40);
      assert.equal(body.acceptPath, `/invitations/${body.token}`);

      // El token no se guarda en claro.
      const stored = await db.sql`SELECT 1 FROM invitations WHERE token_hash = ${body.token}`;
      assert.equal(stored.length, 0);

      const accept = await beto.post(`/api/invitations/${body.token}/accept`);
      assert.equal(accept.status, 200);
      assert.deepEqual(await accept.json(), { projectId, role: "editor" });

      const again = await beto.post(`/api/invitations/${body.token}/accept`);
      assert.equal(again.status, 409);
    });

    await t.step("aceptar exige sesión (401) y un token válido (404)", async () => {
      assert.equal((await new TestClient(app).post("/api/invitations/abc/accept")).status, 401);
      assert.equal((await dani.post("/api/invitations/token-inventado/accept")).status, 404);
    });

    await t.step("una invitación para otro correo no la puede usar otra persona", async () => {
      const res = await ana.post(`${base}/invitations`, { email: carlaUser.email, role: "viewer" });
      const { token } = await res.json();
      const stolen = await dani.post(`/api/invitations/${token}/accept`);
      assert.equal(stolen.status, 409);
      assert.equal((await dani.get(base)).status, 403);

      // La destinataria sí puede.
      assert.equal((await carla.post(`/api/invitations/${token}/accept`)).status, 200);
    });

    await t.step("una invitación vencida responde 404", async () => {
      const res = await ana.post(`${base}/invitations`, {
        email: "dani@example.com",
        role: "viewer",
      });
      const { token, invitation } = await res.json();
      await db.sql`UPDATE invitations SET expires_at = now() - interval '1 minute'
                   WHERE id = ${invitation.id}`;
      assert.equal((await dani.post(`/api/invitations/${token}/accept`)).status, 404);
    });

    await t.step("reenviar revoca la invitación anterior", async () => {
      const first = await (await ana.post(`${base}/invitations`, {
        email: "dani@example.com",
        role: "viewer",
      })).json();
      const second = await (await ana.post(`${base}/invitations`, {
        email: "dani@example.com",
        role: "editor",
      })).json();

      assert.equal((await dani.post(`/api/invitations/${first.token}/accept`)).status, 404);

      const pending = (await (await ana.get(`${base}/invitations`)).json()).invitations;
      assert.deepEqual(pending.map((i: { email: string; role: string }) => [i.email, i.role]), [
        ["dani@example.com", "editor"],
      ]);
      assert.ok(second.token);
    });

    await t.step("invitar a alguien que ya es miembro responde 409", async () => {
      const res = await ana.post(`${base}/invitations`, {
        email: "beto@example.com",
        role: "viewer",
      });
      assert.equal(res.status, 409);
    });

    await t.step("invitar con datos inválidos responde 422 (owner no es invitable)", async () => {
      const res = await ana.post(`${base}/invitations`, { email: "nope", role: "owner" });
      assert.equal(res.status, 422);
      const fields = (await res.json()).error.details.fields;
      assert.ok(fields.email);
      assert.ok(fields.role);
    });

    await t.step("solo el owner invita y ve las invitaciones pendientes", async () => {
      const body = { email: "x@example.com", role: "viewer" };
      assert.equal((await beto.post(`${base}/invitations`, body)).status, 403);
      assert.equal((await carla.post(`${base}/invitations`, body)).status, 403);
      assert.equal((await dani.post(`${base}/invitations`, body)).status, 403);
      assert.equal((await beto.get(`${base}/invitations`)).status, 403);
    });

    await t.step("cualquier miembro ve la lista de miembros; un ajeno no", async () => {
      const res = await carla.get(`${base}/members`);
      assert.equal(res.status, 200);
      const { members } = await res.json();
      assert.deepEqual(members.map((m: { name: string; role: string }) => [m.name, m.role]), [
        ["Ana", "owner"],
        ["Beto", "editor"],
        ["Carla", "viewer"],
      ]);
      assert.equal((await dani.get(`${base}/members`)).status, 403);
    });

    await t.step("el owner cambia roles; editor y viewer no pueden", async () => {
      const res = await ana.patch(`${base}/members/${carlaUser.id}`, { role: "editor" });
      assert.equal(res.status, 200);
      assert.equal((await res.json()).member.role, "editor");

      assert.equal(
        (await beto.patch(`${base}/members/${carlaUser.id}`, { role: "viewer" })).status,
        403,
      );
      assert.equal(
        (await beto.patch(`${base}/members/${betoUser.id}`, { role: "owner" })).status,
        403,
      );
    });

    await t.step("PATCH con rol inválido responde 422; a un no miembro, 404", async () => {
      assert.equal(
        (await ana.patch(`${base}/members/${betoUser.id}`, { role: "admin" })).status,
        422,
      );
      const res = await ana.patch(`${base}/members/${crypto.randomUUID()}`, { role: "viewer" });
      assert.equal(res.status, 404);
    });

    await t.step("no se puede degradar ni quitar al último owner (409)", async () => {
      const demote = await ana.patch(`${base}/members/${anaUser.id}`, { role: "editor" });
      assert.equal(demote.status, 409);
      assert.equal((await demote.json()).error.code, "CONFLICT");

      assert.equal((await ana.delete(`${base}/members/${anaUser.id}`)).status, 409);

      const [m] = await db.sql`
        SELECT role FROM project_members WHERE project_id = ${projectId} AND user_id = ${anaUser.id}`;
      assert.equal(m.role, "owner");
    });

    await t.step("con dos owners, uno puede degradarse o salir", async () => {
      assert.equal(
        (await ana.patch(`${base}/members/${betoUser.id}`, { role: "owner" })).status,
        200,
      );
      // Ahora Beto es owner: Ana puede pasar a editor.
      assert.equal(
        (await ana.patch(`${base}/members/${anaUser.id}`, { role: "editor" })).status,
        200,
      );
      // Y Beto, ahora único owner, no puede degradarse.
      assert.equal(
        (await beto.patch(`${base}/members/${betoUser.id}`, { role: "viewer" })).status,
        409,
      );
      // Beto devuelve el owner a Ana.
      assert.equal(
        (await beto.patch(`${base}/members/${anaUser.id}`, { role: "owner" })).status,
        200,
      );
    });

    await t.step("dos owners degradándose a la vez no dejan el proyecto sin owner", async () => {
      const results = await Promise.all([
        ana.patch(`${base}/members/${anaUser.id}`, { role: "editor" }),
        beto.patch(`${base}/members/${betoUser.id}`, { role: "editor" }),
      ]);
      const statuses = results.map((r) => r.status).sort();
      assert.deepEqual(statuses, [200, 409]);
      const [{ count }] = await db.sql`
        SELECT count(*)::int AS count FROM project_members
        WHERE project_id = ${projectId} AND role = 'owner'`;
      assert.equal(count, 1);
    });

    await t.step("quitar a un miembro: 204 y pierde el acceso", async () => {
      // Quien quedó como owner quita a Carla.
      const [{ user_id: ownerId }] = await db.sql`
        SELECT user_id FROM project_members WHERE project_id = ${projectId} AND role = 'owner'`;
      const owner = ownerId === anaUser.id ? ana : beto;

      assert.equal((await owner.delete(`${base}/members/${carlaUser.id}`)).status, 204);
      assert.equal((await carla.get(base)).status, 403);
      assert.equal((await owner.delete(`${base}/members/${carlaUser.id}`)).status, 404);
    });

    await t.step("cada cambio queda en la auditoría", async () => {
      const { entries } = await (await ana.get(`${base}/audit`)).json();
      const actions = new Set(entries.map((e: { action: string }) => e.action));
      for (
        const a of ["invitation.created", "member.added", "member.role_changed", "member.removed"]
      ) {
        assert.ok(actions.has(a), `falta ${a}`);
      }
    });

    await t.step("el helper joinProject deja al invitado con el rol pedido", async () => {
      const eva = new TestClient(app);
      const evaUser = await eva.register("eva@example.com", "Eva");
      const [{ user_id: ownerId }] = await db.sql`
        SELECT user_id FROM project_members WHERE project_id = ${projectId} AND role = 'owner'`;
      const owner = ownerId === anaUser.id ? ana : beto;
      await joinProject(owner, eva, evaUser.email, projectId, "viewer");
      assert.equal((await (await eva.get(base)).json()).project.role, "viewer");
    });
  } finally {
    await db.close();
  }
});
