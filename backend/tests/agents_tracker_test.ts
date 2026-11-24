import assert from "node:assert/strict";
import { assertIdle, runAgent, runningAgents } from "../src/agents/tracker.ts";
import { ApiError } from "../src/http/errors.ts";

Deno.test("el tracker expone el target y no deja lanzar dos veces el mismo trabajo", async () => {
  const project = crypto.randomUUID();
  let finish!: () => void;
  const first = runAgent(
    project,
    { agent: "arquitecto-datos", task: "Generando", userName: "Joaco", target: "stage:database" },
    () => new Promise<string>((r) => (finish = () => r("ok"))),
  );
  assert.equal(runningAgents(project)[0].target, "stage:database");

  await assert.rejects(
    runAgent(
      project,
      { agent: "arquitecto-datos", task: "Generando", userName: "Ana", target: "stage:database" },
      () => Promise.resolve("dup"),
    ),
    (e) => e instanceof ApiError && /lo pidió Joaco/.test(e.message),
  );
  assert.throws(() => assertIdle(project, "stage:database"), ApiError);
  // Otro trabajo distinto sí puede correr a la vez.
  assert.equal(
    await runAgent(
      project,
      { agent: "disenador-api", task: "Generando", userName: "Ana", target: "stage:backend" },
      () => Promise.resolve("otro"),
    ),
    "otro",
  );

  finish();
  assert.equal(await first, "ok");
  assert.deepEqual(runningAgents(project), []);
  assertIdle(project, "stage:database");
});
