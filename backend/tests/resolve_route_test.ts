import assert from "node:assert/strict";
import type { FrontendArtifact } from "../src/contracts/artifacts.ts";
import { ejemplo } from "../src/engine/ejemplo.ts";
import { createFakeEngine } from "../src/engine/fake.ts";
import type { Engine } from "../src/engine/types.ts";
import { buildApp, TestClient } from "./helpers/app.ts";
import { createTestDb } from "./helpers/db.ts";

/** Frontend del ejemplo sin la única acción que llama a un endpoint. */
function frontendRoto(): FrontendArtifact {
  const fe = structuredClone(ejemplo().stages.frontend!);
  const uses = new Map<string, number>();
  fe.screens.forEach((s) =>
    s.actions.forEach((a) =>
      a.endpointId && uses.set(a.endpointId, (uses.get(a.endpointId) ?? 0) + 1)
    )
  );
  const lone = [...uses].find(([, n]) => n === 1)![0];
  fe.screens.forEach((s) => s.actions = s.actions.filter((a) => a.endpointId !== lone));
  return fe;
}

Deno.test("Resolver con IA: propone, valida y aplica sin desaprobar las etapas siguientes", async (t) => {
  const db = await createTestDb();
  const engine: Engine = {
    ...createFakeEngine(),
    resolveInconsistency: ({ inconsistency }) =>
      Promise.resolve(
        inconsistency.severity === "warning"
          ? {
            kind: "fix" as const,
            stage: "frontend" as const,
            artifact: ejemplo().stages.frontend!,
            summary: "La pantalla vuelve a usar el endpoint.",
          }
          : { kind: "manual" as const, stage: null, explanation: "-" },
      ),
  };
  const app = buildApp({ sql: db.sql, engine });
  const ana = new TestClient(app);

  try {
    await ana.register("ana@example.com", "Ana");
    const created = await ana.post("/api/projects", { name: "Salas", initialIdea: "Reservas" });
    const projectId = (await created.json()).project.id as string;
    const base = `/api/projects/${projectId}`;
    const stage = async (k: string) => (await (await ana.get(`${base}/stages/${k}`)).json()).stage;
    const approve = async (k: string) => {
      const res = await ana.post(`${base}/stages/${k}/approve`, {
        version: (await stage(k)).version,
      });
      assert.equal(res.status, 200, `aprobar ${k}`);
    };

    for (const k of ["definition", "database", "backend", "frontend", "architecture"]) {
      assert.equal((await ana.post(`${base}/stages/${k}/generate`)).status, 200, `generar ${k}`);
      if (k === "frontend") {
        const put = await ana.put(`${base}/stages/frontend`, {
          version: (await stage("frontend")).version,
          artifact: frontendRoto(),
        });
        assert.equal(put.status, 200);
      }
      await approve(k);
    }
    const check = await (await ana.post(`${base}/consistency-check`)).json();
    const inc = check.inconsistencies.find((i: { severity: string }) => i.severity === "warning");
    assert.ok(inc, "debe haber una advertencia abierta");

    let proposal: {
      kind: string;
      stage: string;
      baseVersion: number;
      artifact: unknown;
      summary: string;
      changes: string[];
      wasApproved: boolean;
    };
    await t.step("la propuesta no guarda nada y describe el cambio", async () => {
      const res = await ana.post(`${base}/inconsistencies/${inc.id}/resolution`);
      assert.equal(res.status, 200);
      proposal = (await res.json()).resolution;
      assert.equal(proposal.kind, "fix");
      assert.equal(proposal.stage, "frontend");
      assert.equal(proposal.wasApproved, true);
      assert.ok(proposal.changes.length > 0);
      assert.equal((await stage("frontend")).version, proposal.baseVersion);
    });

    await t.step("el servidor rechaza un cambio que no resuelve la inconsistencia", async () => {
      const res = await ana.post(`${base}/inconsistencies/${inc.id}/resolution/apply`, {
        stage: "frontend",
        version: proposal.baseVersion,
        artifact: frontendRoto(),
      });
      assert.equal(res.status, 409);
    });

    await t.step(
      "aplicar crea una versión aprobada y mantiene la aprobación de arquitectura",
      async () => {
        const res = await ana.post(`${base}/inconsistencies/${inc.id}/resolution/apply`, {
          stage: "frontend",
          version: proposal.baseVersion,
          artifact: proposal.artifact,
          summary: proposal.summary,
        });
        assert.equal(res.status, 200);
        const body = await res.json();
        assert.equal(body.stage.status, "approved");
        assert.equal(body.stage.approvedBy.name, "Ana");
        assert.equal((await stage("architecture")).status, "approved");
        assert.ok(!body.inconsistencies.some((i: { id: string }) => i.id === inc.id));

        const audit = (await (await ana.get(`${base}/audit`)).json()).entries;
        assert.ok(JSON.stringify(audit).includes("inconsistency.ai_resolved"));
      },
    );

    await t.step("una inconsistencia ya resuelta no se vuelve a resolver", async () => {
      const res = await ana.post(`${base}/inconsistencies/${inc.id}/resolution`);
      assert.equal(res.status, 409);
    });
  } finally {
    await db.close();
  }
});
