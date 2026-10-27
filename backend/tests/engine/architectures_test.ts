import assert from "node:assert/strict";
import {
  ARCHITECTURES,
  findArchitecture,
  listArchitectures,
} from "../../src/engine/architectures.ts";

Deno.test("el catálogo tiene exactamente cinco arquitecturas con claves únicas", () => {
  assert.equal(ARCHITECTURES.length, 5);
  assert.equal(new Set(ARCHITECTURES.map((a) => a.key)).size, 5);
});

Deno.test("cada arquitectura define todos los aspectos que exige el enunciado", () => {
  for (const a of ARCHITECTURES) {
    for (
      const field of [
        "name",
        "summary",
        "persistence",
        "backend",
        "frontend",
        "communication",
        "infrastructure",
        "operation",
        "auth",
      ] as const
    ) {
      assert.ok(a[field].trim().length > 0, `${a.key}.${field} está vacío`);
    }
    assert.ok(a.bestFor.length > 0, `${a.key} no dice para qué sirve`);
    assert.ok(a.notRecommendedWhen.length > 0, `${a.key} no dice cuándo evitarla`);
  }
});

Deno.test("listArchitectures devuelve una copia que no altera el catálogo", () => {
  const list = listArchitectures();
  list[0].name = "modificado";
  assert.notEqual(ARCHITECTURES[0].name, "modificado");
});

Deno.test("findArchitecture encuentra por clave y devuelve undefined si no existe", () => {
  assert.equal(findArchitecture("edge-first")?.name, "Edge-first distribuida");
  assert.equal(findArchitecture("no-existe"), undefined);
});
