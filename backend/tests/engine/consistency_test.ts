import assert from "node:assert/strict";
import { checkConsistency, hasCritical } from "../../src/engine/consistency.ts";
import type { Inconsistency, ProjectContext } from "../../src/engine/types.ts";
import { ejemplo } from "../../src/engine/ejemplo.ts";

/** Aplica una modificación al ejemplo y devuelve las inconsistencias. */
function check(mutate: (ctx: ProjectContext) => void): Inconsistency[] {
  const ctx = ejemplo();
  mutate(ctx);
  return checkConsistency(ctx);
}

function expectIssue(
  issues: Inconsistency[],
  severity: Inconsistency["severity"],
  pattern: RegExp,
) {
  const found = issues.find((i) => i.severity === severity && pattern.test(i.description));
  assert.ok(
    found,
    `Se esperaba un ${severity} que calce con ${pattern}. Encontrados:\n` +
      issues.map((i) => `- [${i.severity}] ${i.description}`).join("\n"),
  );
}

Deno.test("el proyecto de ejemplo no tiene inconsistencias", () => {
  const issues = checkConsistency(ejemplo());
  assert.deepEqual(issues, [], issues.map((i) => i.description).join("\n"));
});

Deno.test("solo revisa las etapas presentes", () => {
  const ctx = ejemplo();
  delete ctx.stages.backend;
  delete ctx.stages.frontend;
  delete ctx.stages.architecture;
  assert.deepEqual(checkConsistency(ctx), []);
});

// ------------------------------------------------------------ Definición
Deno.test("requisito de una funcionalidad que no está en el MVP", () => {
  expectIssue(
    check((c) => c.stages.definition!.requirements[0].featureId = "FEAT-9"),
    "critical",
    /REQ-1 pertenece a FEAT-9/,
  );
});

Deno.test("requisito con un rol inexistente", () => {
  expectIssue(
    check((c) => c.stages.definition!.requirements[0].roleIds.push("ROLE-9")),
    "critical",
    /REQ-1 menciona el rol ROLE-9/,
  );
});

Deno.test("paso del recorrido con un rol inexistente", () => {
  expectIssue(
    check((c) => c.stages.definition!.mainJourney[0].actorRoleId = "ROLE-9"),
    "critical",
    /paso 1 .* ROLE-9/,
  );
});

Deno.test("funcionalidad sin requisitos", () => {
  expectIssue(
    check((c) =>
      c.stages.definition!.mvp.included.push({ id: "FEAT-5", title: "Chat", description: "" })
    ),
    "warning",
    /FEAT-5 \(Chat\) no tiene ningún requisito/,
  );
});

Deno.test("ids de rol duplicados", () => {
  expectIssue(
    check((c) => c.stages.definition!.userTypes[1].id = "ROLE-1"),
    "critical",
    /rol ROLE-1 está definido más de una vez/,
  );
});

// ------------------------------------------------------------ Base de datos
Deno.test("entidad sin clave primaria", () => {
  expectIssue(
    check((c) => c.stages.database!.entities[1].attributes[0].primaryKey = false),
    "critical",
    /"rooms" no tiene clave primaria/,
  );
});

Deno.test("entidad que soporta un requisito inexistente", () => {
  expectIssue(
    check((c) => c.stages.database!.entities[0].supports.push("REQ-99")),
    "critical",
    /"users" dice soportar REQ-99/,
  );
});

Deno.test("entidad sin justificación", () => {
  expectIssue(
    check((c) => c.stages.database!.entities[0].supports = []),
    "warning",
    /"users" no indica qué requisito/,
  );
});

Deno.test("relación hacia una columna inexistente", () => {
  expectIssue(
    check((c) => c.stages.database!.relationships[0].toColumn = "uuid"),
    "critical",
    /columna inexistente rooms\.uuid/,
  );
});

Deno.test("relación hacia una entidad inexistente", () => {
  expectIssue(
    check((c) => c.stages.database!.relationships[0].to = "salas"),
    "critical",
    /apunta a una entidad inexistente/,
  );
});

Deno.test("índice sobre una columna inexistente", () => {
  expectIssue(
    check((c) => c.stages.database!.entities[2].indexes[0].columns.push("fecha")),
    "critical",
    /índice de "reservations" usa la columna "fecha"/,
  );
});

// ------------------------------------------------------------ Backend
Deno.test("endpoint que usa una entidad inexistente", () => {
  expectIssue(
    check((c) => c.stages.backend!.endpoints[0].entities.push("bookings")),
    "critical",
    /EP-1 .* entidad "bookings"/,
  );
});

Deno.test("endpoint con sesión que no documenta 401", () => {
  expectIssue(
    check((c) => {
      const ep = c.stages.backend!.endpoints[2];
      ep.responses = ep.responses.filter((r) => r.status !== 401);
    }),
    "critical",
    /EP-3 .* no documenta la respuesta 401/,
  );
});

Deno.test("endpoint restringido por rol que no documenta 403", () => {
  expectIssue(
    check((c) => {
      const ep = c.stages.backend!.endpoints[4];
      ep.responses = ep.responses.filter((r) => r.status !== 403);
    }),
    "critical",
    /EP-5 .* restringido a ROLE-2 .* 403/,
  );
});

Deno.test("endpoint abierto a todos los roles no necesita 403", () => {
  const issues = check((c) => c.stages.backend!.endpoints[0].allowedRoleIds = ["ROLE-1", "ROLE-2"]);
  assert.ok(!issues.some((i) => /403/.test(i.description)));
});

Deno.test("rutas duplicadas", () => {
  expectIssue(
    check((c) => {
      c.stages.backend!.endpoints[5].path = "/rooms";
      c.stages.backend!.endpoints[5].method = "POST";
    }),
    "critical",
    /La ruta POST \/rooms está definida más de una vez/,
  );
});

Deno.test("parámetro de ruta sin describir", () => {
  expectIssue(
    check((c) => c.stages.backend!.endpoints[3].request.pathParams = []),
    "warning",
    /":id" sin describirlo/,
  );
});

Deno.test("requisito sin endpoint", () => {
  expectIssue(
    check((c) => c.stages.backend!.endpoints[2].requirementIds = []),
    "warning",
    /REQ-3 no está implementado por ningún endpoint/,
  );
});

Deno.test("endpoint sin respuesta exitosa", () => {
  expectIssue(
    check((c) => {
      const ep = c.stages.backend!.endpoints[6];
      ep.responses = ep.responses.filter((r) => r.status >= 300);
    }),
    "critical",
    /EP-7 .* ninguna respuesta exitosa/,
  );
});

// ------------------------------------------------------------ Frontend
Deno.test("acción que llama a un endpoint inexistente", () => {
  expectIssue(
    check((c) => c.stages.frontend!.screens[3].actions[0].endpointId = "EP-99"),
    "critical",
    /"Cargar reservas" de SCR-4 llama a EP-99/,
  );
});

Deno.test("acción visible para un rol que el endpoint no permite", () => {
  expectIssue(
    check((c) => c.stages.frontend!.screens[4].visibleToRoleIds = ["ROLE-1", "ROLE-2"]),
    "critical",
    /"Crear sala" de SCR-5 se muestra a ROLE-1, pero EP-5 no permite ese rol/,
  );
});

Deno.test("funcionalidad del MVP sin pantalla", () => {
  expectIssue(
    check((c) => c.stages.frontend!.screens[4].featureIds = []),
    "critical",
    /FEAT-4 \(Administrar salas\) no aparece en ninguna pantalla/,
  );
});

Deno.test("navegación hacia una pantalla inexistente", () => {
  expectIssue(
    check((c) => c.stages.frontend!.screens[1].actions[1].navigatesTo = "SCR-9"),
    "critical",
    /lleva a SCR-9/,
  );
});

Deno.test("pantalla inalcanzable", () => {
  expectIssue(
    check((c) => {
      const fe = c.stages.frontend!;
      fe.navigation = fe.navigation.filter((n) => n.to !== "SCR-5");
      fe.screens[1].actions = fe.screens[1].actions.filter((a) => a.navigatesTo !== "SCR-5");
    }),
    "warning",
    /llegar a la pantalla SCR-5/,
  );
});

Deno.test("endpoint que ninguna pantalla usa", () => {
  expectIssue(
    check((c) => c.stages.frontend!.screens[0].actions[0].endpointId = undefined),
    "warning",
    /EP-7 .* no se usa en ninguna pantalla/,
  );
});

Deno.test("pantalla de inicio inexistente", () => {
  expectIssue(
    check((c) => c.stages.frontend!.entryScreenId = "SCR-0"),
    "critical",
    /pantalla de inicio SCR-0 no existe/,
  );
});

// ------------------------------------------------------------ Arquitectura
Deno.test("arquitectura que no está en el catálogo", () => {
  expectIssue(
    check((c) => c.stages.architecture!.selectedKey = "serverless"),
    "critical",
    /"serverless" no está en el catálogo/,
  );
});

Deno.test("tecnología con alternativas abiertas", () => {
  expectIssue(
    check((c) => c.stages.architecture!.stack.backend = "Fastify + Prisma o Drizzle"),
    "critical",
    /backend deja alternativas abiertas/,
  );
});

Deno.test("tecnología sin definir", () => {
  expectIssue(
    check((c) => c.stages.architecture!.stack.database = " "),
    "critical",
    /No se definió la tecnología de base de datos/,
  );
});

Deno.test("hasCritical distingue críticas de advertencias", () => {
  assert.equal(hasCritical([{ severity: "warning", stages: [], description: "" }]), false);
  assert.equal(hasCritical([{ severity: "critical", stages: [], description: "" }]), true);
});

Deno.test("detecta rutas de pantalla repetidas o que chocan con la API", () => {
  const ctx = ejemplo();
  const screens = ctx.stages.frontend!.screens;
  screens[1].route = screens[0].route;
  screens[2].route = "/rooms";
  const text = checkConsistency(ctx).map((i) => i.description).join("\n");
  assert.match(text, /ruta \/app\/login está asignada a más de una pantalla/);
  assert.match(text, /SCR-3 usa la ruta \/rooms/);
});

Deno.test("una funcionalidad declarada fuera de la interfaz no exige pantalla", () => {
  const ctx = ejemplo();
  const fe = ctx.stages.frontend!;
  const feat = ctx.stages.definition!.mvp.included[3].id;
  fe.screens.forEach((s) => s.featureIds = s.featureIds.filter((f) => f !== feat));
  assert.match(
    checkConsistency(ctx).map((i) => i.description).join("\n"),
    new RegExp(`${feat} .* no aparece`),
  );
  fe.featuresWithoutScreen = [{ featureId: feat, reason: "Se opera con un comando interno." }];
  assert.doesNotMatch(
    checkConsistency(ctx).map((i) => i.description).join("\n"),
    new RegExp(`${feat} .* no aparece`),
  );
  fe.featuresWithoutScreen = [{ featureId: "FEAT-99", reason: "x" }];
  assert.match(checkConsistency(ctx).map((i) => i.description).join("\n"), /FEAT-99, que no es/);
});

Deno.test("featuresWithoutScreen acepta la explicación con otro nombre y exige que exista", async () => {
  const { parseFrontendArtifact } = await import("../../src/engine/validate.ts");
  const fe = structuredClone(ejemplo().stages.frontend!) as unknown as Record<string, unknown>;
  fe.featuresWithoutScreen = [{ featureId: "FEAT-4", description: "Se opera con un comando." }];
  assert.equal(
    parseFrontendArtifact(fe, "artifact").featuresWithoutScreen?.[0].reason,
    "Se opera con un comando.",
  );
  fe.featuresWithoutScreen = [{ featureId: "FEAT-4" }];
  assert.throws(() => parseFrontendArtifact(fe, "artifact"), /reason debe ser texto: una frase/);
});
