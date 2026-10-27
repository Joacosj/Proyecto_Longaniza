import assert from "node:assert/strict";
import { renderDocuments, table } from "../../src/engine/documents.ts";
import { ejemplo } from "../../src/engine/ejemplo.ts";

const docs = () => renderDocuments(ejemplo());

Deno.test("la especificación incluye todas las tablas y columnas del modelo", () => {
  const { productSpec } = docs();
  for (const e of ejemplo().stages.database!.entities) {
    assert.ok(productSpec.includes(`### Tabla \`${e.name}\``), `falta la tabla ${e.name}`);
    for (const a of e.attributes) {
      assert.ok(productSpec.includes(`\`${a.name}\``), `falta la columna ${e.name}.${a.name}`);
    }
  }
});

Deno.test("la especificación incluye cada endpoint con todos sus códigos de respuesta", () => {
  const { productSpec } = docs();
  for (const e of ejemplo().stages.backend!.endpoints) {
    const heading = `### ${e.id} · \`${e.method} ${e.path}\``;
    const start = productSpec.indexOf(heading);
    assert.ok(start >= 0, `falta ${heading}`);
    const section = productSpec.slice(start, productSpec.indexOf("\n### ", start + 1));
    for (const r of e.responses) {
      assert.match(section, new RegExp(`\\| ${r.status} \\|`), `${e.id} no muestra ${r.status}`);
    }
  }
});

Deno.test("la especificación incluye cada pantalla, requisito, regla y rol", () => {
  const { productSpec } = docs();
  const def = ejemplo().stages.definition!;
  for (const s of ejemplo().stages.frontend!.screens) {
    assert.ok(productSpec.includes(`### ${s.id} · ${s.name}`), `falta la pantalla ${s.id}`);
  }
  for (
    const id of [
      ...def.requirements.map((r) => r.id),
      ...def.businessRules.map((r) => r.id),
      ...def.userTypes.map((r) => r.id),
      ...def.mvp.included.map((f) => f.id),
    ]
  ) {
    assert.ok(productSpec.includes(id), `falta ${id}`);
  }
});

Deno.test("incluye las decisiones confirmadas y marca los temas abiertos como fuera de alcance", () => {
  const { productSpec } = docs();
  assert.match(productSpec, /## 13\. Decisiones confirmadas/);
  assert.match(productSpec, /cuenta institucional de Microsoft/);
  assert.match(productSpec, /## 14\. Temas abiertos/);
  assert.match(productSpec, /recordatorios por correo/);
});

Deno.test("el documento de arquitectura incluye la elección, el stack, la autenticación y la operación", () => {
  const { architecture } = docs();
  const ar = ejemplo().stages.architecture!;
  assert.match(architecture, /Monolito modular moderno/);
  for (const v of Object.values(ar.stack)) assert.ok(architecture.includes(v), `falta ${v}`);
  for (const v of ar.deployment.envVars) {
    assert.ok(architecture.includes(v.name), `falta ${v.name}`);
  }
  assert.ok(architecture.includes(ar.auth.sso));
  assert.match(architecture, /### Alternativas descartadas/);
  assert.match(architecture, /## 7\. Observabilidad/);
});

Deno.test("los diagramas Mermaid incluyen entidades, relaciones y navegación", () => {
  const { productSpec } = docs();
  assert.match(productSpec, /```mermaid\nerDiagram/);
  assert.match(productSpec, /rooms \|\|--o\{ reservations : "room_id"/);
  assert.match(productSpec, /uuid room_id FK/);
  assert.match(productSpec, /```mermaid\nflowchart LR/);
  assert.match(productSpec, /SCR_2 -->\|"Reservar"\| SCR_3/);
});

Deno.test("no quedan valores sin resolver ni referencias a la conversación", () => {
  const { productSpec, architecture } = docs();
  for (const doc of [productSpec, architecture]) {
    assert.doesNotMatch(doc, /undefined|null|\[object Object\]|\(\?\)/);
    assert.doesNotMatch(doc, /como se (dijo|mencionó)|anteriormente/i);
  }
});

Deno.test("falla con un mensaje claro si falta una etapa", () => {
  const ctx = ejemplo();
  delete ctx.stages.frontend;
  assert.throws(() => renderDocuments(ctx), /faltan las etapas frontend/);
});

Deno.test("table escapa barras verticales y saltos de línea", () => {
  assert.equal(table(["a"], [["x | y\nz"]]), "| a |\n|---|\n| x \\| y z |");
});

Deno.test("el diagrama ER usa tipos simples y no hay formato de error fijo que contradiga la API", () => {
  const ctx = ejemplo();
  ctx.stages.database!.entities[0].attributes[1].type = "varchar(254)";
  ctx.stages.database!.entities[0].attributes.push({
    name: "fallos",
    type: "timestamptz[]",
    nullable: false,
    primaryKey: false,
    unique: false,
  });
  const { productSpec } = renderDocuments(ctx);
  assert.match(productSpec, /    varchar email UK/);
  assert.match(productSpec, /    timestamptz_array fallos/);
  assert.doesNotMatch(productSpec, /Formato de error para cualquier respuesta/);
  assert.doesNotMatch(productSpec, /Cuerpo \(JSON\)/);
});
