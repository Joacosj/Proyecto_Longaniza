/**
 * Generador de los dos documentos finales de Ideator. Determinista: no usa la IA.
 *
 * Los documentos los leerá una IA que no participó del proceso, así que cada uno debe ser
 * autocontenido: nombra las cosas por su id y su nombre, repite el contexto necesario y no
 * se refiere a conversaciones previas.
 */
import type {
  ArchitectureTemplate,
  BackendArtifact,
  DatabaseArtifact,
  DefinitionArtifact,
  Field,
  FrontendArtifact,
} from "../contracts/artifacts.ts";
import { ARCHITECTURES } from "./architectures.ts";
import type { ProjectContext } from "./types.ts";

export interface GeneratedDocuments {
  productSpec: string;
  architecture: string;
}

/**
 * Genera ambos documentos. Lanza un error si falta alguna etapa: la mitad A debe verificar
 * antes que todas estén aprobadas y sin inconsistencias críticas.
 */
export function renderDocuments(
  context: ProjectContext,
  catalog: readonly ArchitectureTemplate[] = ARCHITECTURES,
): GeneratedDocuments {
  const { definition, database, backend, frontend, architecture } = context.stages;
  const missing = Object.entries({ definition, database, backend, frontend, architecture })
    .filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) {
    throw new Error(`No se pueden generar los documentos: faltan las etapas ${missing.join(", ")}`);
  }
  const roles = new Map(definition!.userTypes.map((r) => [r.id, r.name]));
  const ctx: Ctx = { roles, project: context };

  return {
    productSpec: productSpec(ctx, definition!, database!, backend!, frontend!),
    architecture: architectureDoc(ctx, catalog, database!),
  };
}

interface Ctx {
  roles: Map<string, string>;
  project: ProjectContext;
}

// ====================================================================== Especificación
function productSpec(
  ctx: Ctx,
  def: DefinitionArtifact,
  db: DatabaseArtifact,
  be: BackendArtifact,
  fe: FrontendArtifact,
): string {
  const p = ctx.project;
  const out: string[] = [];
  const features = new Map(def.mvp.included.map((f) => [f.id, f.title]));
  const endpoints = new Map(be.endpoints.map((e) => [e.id, e]));
  const screens = new Map(fe.screens.map((s) => [s.id, s.name]));

  out.push(
    `# Especificación de producto: ${p.projectName}`,
    "",
    "> **Instrucciones para quien implemente.** Este documento y el documento de arquitectura " +
      "son la única fuente de verdad. Implementa exactamente lo descrito: no agregues " +
      "funcionalidades fuera del MVP, respeta los nombres de tablas, columnas, rutas y códigos " +
      "de respuesta, y aplica todas las reglas de negocio en el backend. Los identificadores " +
      "(ROLE-, FEAT-, REQ-, RULE-, EP-, SCR-) sirven para cruzar las secciones.",
    "",
    "## 1. Problema",
    "",
    `**Idea original:** ${p.initialIdea}`,
    "",
    `**Problema:** ${def.problem.statement}`,
    "",
    `**Contexto:** ${def.problem.context}`,
    "",
    `**Mejora esperada:** ${def.problem.expectedImprovement}`,
    "",
    "## 2. Usuarios y roles",
    "",
    table(
      ["Id", "Rol", "Descripción", "Objetivos"],
      def.userTypes.map((r) => [r.id, r.name, r.description, r.goals.join("; ")]),
    ),
    "",
    "## 3. Resultados esperados",
    "",
    bullets(def.expectedOutcomes),
    "",
    "## 4. Alcance del MVP",
    "",
    "### Incluido",
    "",
    table(
      ["Id", "Funcionalidad", "Descripción"],
      def.mvp.included.map((f) => [f.id, f.title, f.description]),
    ),
    "",
    "### Fuera de alcance (no implementar)",
    "",
    def.mvp.excluded.length
      ? table(["Funcionalidad", "Motivo"], def.mvp.excluded.map((f) => [f.title, f.reason]))
      : "_Nada quedó explícitamente fuera._",
    "",
    "## 5. Recorrido principal",
    "",
    def.mainJourney
      .slice().sort((a, b) => a.step - b.step)
      .map((s) => `${s.step}. **${roleName(ctx, s.actorRoleId)}:** ${s.action}. → ${s.result}.`)
      .join("\n"),
    "",
    "## 6. Requisitos funcionales",
    "",
    table(
      ["Id", "Requisito", "Funcionalidad", "Roles"],
      def.requirements.map((r) => [
        r.id,
        r.description,
        `${r.featureId} (${features.get(r.featureId) ?? "?"})`,
        r.roleIds.map((id) => roleName(ctx, id)).join(", "),
      ]),
    ),
    "",
    "## 7. Reglas de negocio",
    "",
    def.businessRules.length
      ? def.businessRules.map((r) => `- **${r.id}:** ${r.rule}`).join("\n")
      : "_Sin reglas de negocio adicionales._",
    "",
    "## 8. Restricciones, integraciones y seguridad",
    "",
    "### Restricciones",
    "",
    bullets(def.constraints, "_Sin restricciones adicionales._"),
    "",
    "### Integraciones externas",
    "",
    def.integrations.length
      ? table(
        ["Servicio", "Uso", "Si no está disponible"],
        def.integrations.map((i) => [i.name, i.purpose, i.onFailure]),
      )
      : "_Sin integraciones externas._",
    "",
    "### Seguridad",
    "",
    bullets(def.security, "_Sin requisitos de seguridad adicionales._"),
    "",
    "## 9. Casos borde",
    "",
    def.edgeCases.length
      ? table(
        ["Situación", "Comportamiento esperado"],
        def.edgeCases.map((e) => [e.situation, e.expectedBehavior]),
      )
      : "_Sin casos borde documentados._",
    "",
  );

  // ------------------------------------------------------------ Datos
  out.push("## 10. Modelo de datos", "", db.overview, "", "```mermaid", erDiagram(db), "```", "");
  for (const e of db.entities) {
    const fks = new Map(
      db.relationships.filter((r) => r.from === e.name).map((
        r,
      ) => [r.fromColumn, `${r.to}.${r.toColumn}`]),
    );
    out.push(
      `### Tabla \`${e.name}\``,
      "",
      e.description + (e.supports.length ? ` Soporta: ${e.supports.join(", ")}.` : ""),
      "",
      table(
        ["Columna", "Tipo", "Nulo", "Clave", "Único", "Por defecto", "Descripción"],
        e.attributes.map((a) => [
          `\`${a.name}\``,
          a.type,
          a.nullable ? "sí" : "no",
          [a.primaryKey && "PK", fks.has(a.name) && `FK → ${fks.get(a.name)}`].filter(Boolean).join(
            ", ",
          ),
          a.unique && !a.primaryKey ? "sí" : "",
          a.default ? `\`${a.default}\`` : "",
          a.description ?? "",
        ]),
      ),
      "",
    );
    if (e.indexes.length) {
      out.push(
        "**Índices:**",
        "",
        bullets(
          e.indexes.map((i) => `${i.unique ? "Único" : "Índice"} sobre (${i.columns.join(", ")})`),
        ),
        "",
      );
    }
    if (e.constraints.length) {
      out.push("**Restricciones:**", "", bullets(e.constraints.map((c) => `\`${c}\``)), "");
    }
  }
  if (db.relationships.length) {
    out.push(
      "### Relaciones",
      "",
      table(
        ["Desde", "Hacia", "Cardinalidad", "Al eliminar"],
        db.relationships.map((r) => [
          `${r.from}.${r.fromColumn}`,
          `${r.to}.${r.toColumn}`,
          r.cardinality,
          ON_DELETE[r.onDelete],
        ]),
      ),
      "",
    );
  }

  // ------------------------------------------------------------ API
  out.push(
    "## 11. API",
    "",
    be.overview,
    "",
    `**Autenticación:** ${be.auth.scheme}. ${be.auth.description}`,
    "",
    table(
      ["Id", "Método", "Ruta", "Descripción", "Roles"],
      be.endpoints.map((e) => [e.id, e.method, `\`${e.path}\``, e.summary, endpointRoles(ctx, e)]),
    ),
    "",
  );
  for (const e of be.endpoints) {
    out.push(
      `### ${e.id} · \`${e.method} ${e.path}\``,
      "",
      e.summary,
      "",
      `- **Requiere sesión:** ${e.requiresAuth ? "sí" : "no"}`,
      `- **Roles permitidos:** ${endpointRoles(ctx, e)}`,
      `- **Tablas:** ${e.entities.map((n) => `\`${n}\``).join(", ") || "ninguna"}`,
      `- **Requisitos:** ${e.requirementIds.join(", ") || "—"}`,
      "",
    );
    const sections: [string, Field[]][] = [
      ["Parámetros de ruta", e.request.pathParams],
      ["Parámetros de consulta", e.request.queryParams],
      ["Cabeceras", e.request.headers],
      ["Cuerpo", e.request.body],
    ];
    for (const [title, fields] of sections) {
      if (fields.length) out.push(`**${title}:**`, "", fieldsTable(fields), "");
    }
    out.push(
      "**Respuestas:**",
      "",
      table(
        ["Código", "Cuándo", "Cuerpo"],
        e.responses.slice().sort((a, b) => a.status - b.status).map((r) => [
          String(r.status),
          r.when,
          r.body.length ? r.body.map((f) => `\`${f.name}\`: ${f.type}`).join("; ") : "vacío",
        ]),
      ),
      "",
    );
  }

  // ------------------------------------------------------------ Interfaz
  out.push(
    "## 12. Interfaz",
    "",
    `Pantalla inicial: **${fe.entryScreenId} (${screens.get(fe.entryScreenId) ?? "?"})**.`,
    "",
    "```mermaid",
    navigationDiagram(fe),
    "```",
    "",
  );
  for (const s of fe.screens) {
    out.push(
      `### ${s.id} · ${s.name}`,
      "",
      s.purpose,
      "",
      `- **Visible para:** ${
        s.visibleToRoleIds.length
          ? s.visibleToRoleIds.map((r) => roleName(ctx, r)).join(", ")
          : "cualquier visitante, sin sesión"
      }`,
      `- **Funcionalidades:** ${
        s.featureIds.map((f) => `${f} (${features.get(f) ?? "?"})`).join(", ") || "—"
      }`,
      "",
      "**Contenido, en orden:**",
      "",
      s.layout.map((b, i) =>
        `${i + 1}. [${REGION[b.region]}] ${COMPONENT[b.component]} "${b.label}"` +
        (b.fields?.length ? `: ${b.fields.join(", ")}` : "")
      ).join("\n"),
      "",
    );
    if (s.actions.length) {
      out.push(
        "**Acciones:**",
        "",
        table(
          ["Acción", "Llama a", "Lleva a", "Visible para"],
          s.actions.map((a) => {
            const ep = a.endpointId ? endpoints.get(a.endpointId) : undefined;
            return [
              a.label,
              ep ? `${ep.id} \`${ep.method} ${ep.path}\`` : (a.endpointId ?? "—"),
              a.navigatesTo ? `${a.navigatesTo} (${screens.get(a.navigatesTo) ?? "?"})` : "—",
              a.visibleToRoleIds?.length
                ? a.visibleToRoleIds.map((r) => roleName(ctx, r)).join(", ")
                : "todos los que ven la pantalla",
            ];
          }),
        ),
        "",
      );
    }
    out.push(
      `**Estados:** vacío: ${s.states.empty} · cargando: ${s.states.loading} · error: ${s.states.error}`,
      "",
    );
  }

  // ------------------------------------------------------------ Decisiones
  out.push("## 13. Decisiones confirmadas", "");
  out.push(
    p.answeredQuestions.length
      ? p.answeredQuestions.map((q) => `- **${q.text}** ${q.answer}`).join("\n")
      : "_Sin preguntas adicionales._",
    "",
  );
  const open = p.openQuestions.filter((q) => !q.isBlocking);
  if (open.length) {
    out.push(
      "## 14. Temas abiertos (fuera de esta versión)",
      "",
      "No implementar nada relacionado con estos temas; quedan para una versión futura.",
      "",
      bullets(open.map((q) => q.text)),
      "",
    );
  }

  return out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

// ====================================================================== Arquitectura
function architectureDoc(
  ctx: Ctx,
  catalog: readonly ArchitectureTemplate[],
  db: DatabaseArtifact,
): string {
  const p = ctx.project;
  const ar = p.stages.architecture!;
  const tpl = catalog.find((a) => a.key === ar.selectedKey);
  const name = (key: string) => catalog.find((a) => a.key === key)?.name ?? key;
  const out: string[] = [];

  out.push(
    `# Arquitectura: ${p.projectName}`,
    "",
    "> **Instrucciones para quien implemente.** Usa exactamente las tecnologías y decisiones " +
      "de este documento. El detalle funcional (tablas, endpoints y pantallas) está en la " +
      "especificación de producto.",
    "",
    "## 1. Arquitectura elegida",
    "",
    `**${name(ar.selectedKey)}.**${tpl ? " " + tpl.summary : ""}`,
    "",
    `**Por qué:** ${ar.justification}`,
    "",
  );
  if (ar.discarded.length) {
    out.push(
      "### Alternativas descartadas",
      "",
      table(["Arquitectura", "Motivo"], ar.discarded.map((d) => [name(d.key), d.reason])),
      "",
    );
  }

  out.push(
    "## 2. Tecnologías",
    "",
    table(["Capa", "Tecnología"], [
      ["Base de datos", ar.stack.database],
      ["Backend", ar.stack.backend],
      ["Frontend", ar.stack.frontend],
      ["Comunicación", ar.stack.communication],
      ...(ar.stack.fileStorage ? [["Archivos subidos", ar.stack.fileStorage]] : []),
    ]),
    "",
  );

  if (tpl) {
    out.push(
      "## 3. Organización de la solución",
      "",
      `- **Backend:** ${tpl.backend}`,
      `- **Frontend:** ${tpl.frontend}`,
      `- **Persistencia:** ${tpl.persistence}`,
      `- **Comunicación:** ${tpl.communication}`,
      `- **Infraestructura:** ${tpl.infrastructure}`,
      "",
    );
  }

  out.push(
    "## 4. Base de datos",
    "",
    `Motor: ${ar.stack.database}. Tablas: ${db.entities.map((e) => `\`${e.name}\``).join(", ")}. ` +
      "Las columnas, claves, índices y restricciones están en la sección 10 de la especificación " +
      "de producto y deben crearse mediante migraciones versionadas.",
    "",
    "## 5. Autenticación y autorización",
    "",
    `- **Identidad:** ${ar.auth.identity}`,
    `- **SSO:** ${ar.auth.sso}`,
    `- **Sesión o token:** ${ar.auth.session}`,
    `- **Autorización:** ${ar.auth.authorization}`,
    `- **Roles:** ${[...ctx.roles].map(([id, n]) => `${id} (${n})`).join(", ")}`,
    "",
    "La autorización se valida siempre en el backend. Sin identidad válida: 401. Con identidad " +
      "pero sin permiso sobre el recurso: 403.",
    "",
    "## 6. Despliegue",
    "",
    ar.deployment.strategy,
    "",
    `**Ambientes:** ${ar.deployment.environments.join(", ")}.`,
    "",
  );
  if (ar.deployment.envVars.length) {
    out.push(
      "**Variables de entorno** (los secretos nunca van en el código ni en el repositorio):",
      "",
      table(["Variable", "Uso"], ar.deployment.envVars.map((v) => [`\`${v.name}\``, v.purpose])),
      "",
    );
  }
  out.push(
    "## 7. Observabilidad",
    "",
    table(["Aspecto", "Decisión"], [
      ["Logs", ar.observability.logging],
      ["Métricas", ar.observability.metrics],
      ["Trazabilidad", ar.observability.tracing],
      ["Verificación de estado", ar.observability.healthChecks],
    ]),
    "",
  );
  if (tpl) out.push("## 8. Operación", "", tpl.operation, "");

  return out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

// ====================================================================== Diagramas
function erDiagram(db: DatabaseArtifact): string {
  const fkCols = new Set(db.relationships.map((r) => `${r.from}.${r.fromColumn}`));
  const lines = ["erDiagram"];
  for (const e of db.entities) {
    lines.push(`  ${mermaidId(e.name)} {`);
    for (const a of e.attributes) {
      const keys = [
        a.primaryKey && "PK",
        fkCols.has(`${e.name}.${a.name}`) && "FK",
        a.unique && !a.primaryKey && "UK",
      ].filter(Boolean).join(",");
      lines.push(`    ${erType(a.type)} ${mermaidId(a.name)}${keys ? " " + keys : ""}`);
    }
    lines.push("  }");
  }
  for (const r of db.relationships) {
    lines.push(
      `  ${mermaidId(r.to)} ${ER_EDGE[r.cardinality]} ${mermaidId(r.from)} : "${r.fromColumn}"`,
    );
  }
  return lines.join("\n");
}

function navigationDiagram(fe: FrontendArtifact): string {
  const lines = ["flowchart LR"];
  for (const s of fe.screens) lines.push(`  ${mermaidId(s.id)}["${s.id} ${quote(s.name)}"]`);
  for (const n of fe.navigation) {
    lines.push(`  ${mermaidId(n.from)} -->|"${quote(n.trigger)}"| ${mermaidId(n.to)}`);
  }
  return lines.join("\n");
}

// ====================================================================== Utilidades
const ON_DELETE = {
  cascade: "elimina en cascada",
  restrict: "impide eliminar",
  "set null": "deja en NULL",
};
const ER_EDGE = { "1:1": "||--||", "1:N": "||--o{", "N:M": "}o--o{" };
const REGION = {
  header: "encabezado",
  sidebar: "lateral",
  main: "principal",
  footer: "pie",
  modal: "modal",
};
const COMPONENT = {
  title: "Título",
  text: "Texto",
  form: "Formulario",
  table: "Tabla",
  list: "Lista",
  card: "Tarjeta",
  button: "Botón",
  nav: "Navegación",
};

function roleName(ctx: Ctx, id: string): string {
  const n = ctx.roles.get(id);
  return n ? `${n} (${id})` : id;
}

function endpointRoles(ctx: Ctx, e: BackendArtifact["endpoints"][number]): string {
  if (!e.requiresAuth) return "público";
  return e.allowedRoleIds.length
    ? e.allowedRoleIds.map((r) => roleName(ctx, r)).join(", ")
    : "cualquier usuario con sesión";
}

function fieldsTable(fields: Field[]): string {
  return table(
    ["Nombre", "Tipo", "Obligatorio", "Validación", "Descripción"],
    fields.map((
      f,
    ) => [
      `\`${f.name}\``,
      f.type,
      f.required ? "sí" : "no",
      f.validation ?? "",
      f.description ?? "",
    ]),
  );
}

export function table(headers: string[], rows: string[][]): string {
  const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim();
  return [
    `| ${headers.map(cell).join(" | ")} |`,
    `|${headers.map(() => "---").join("|")}|`,
    ...rows.map((r) => `| ${r.map(cell).join(" | ")} |`),
  ].join("\n");
}

function bullets(items: string[], empty = "_Ninguno._"): string {
  return items.length ? items.map((i) => `- ${i}`).join("\n") : empty;
}

/** Tipo legible para Mermaid: "varchar(100)" → "varchar", "timestamptz[]" → "timestamptz_array". */
function erType(type: string): string {
  const base = type.trim().replace(/\(.*\)/, "").replace(/\[\]$/, "_array");
  return mermaidId(base).replace(/_+/g, "_").replace(/^_|_$/g, "") || "text";
}

function mermaidId(s: string): string {
  return s.replace(/[^A-Za-z0-9_]/g, "_");
}

function quote(s: string): string {
  return s.replace(/"/g, "'");
}
