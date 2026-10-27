/**
 * Instrucciones para generar las etapas 2 a 5 a partir de las anteriores.
 *
 * Cada etapa recibe como contexto las etapas previas en JSON y debe referenciar sus ids
 * exactos. El resultado lo valida el código (validate.ts) y el validador de consistencia;
 * si algo no calza, se le devuelve el error a la IA para que corrija.
 */
import type { ArchitectureTemplate, StageKind } from "../../contracts/artifacts.ts";
import { STAGE_ORDER } from "../../contracts/artifacts.ts";
import type { GeneratableStage, ProjectContext } from "../types.ts";

const COMMON = `
Eres el arquitecto de software de Ideator. Ideator convierte una idea en una especificación que
otra IA implementará SIN poder hacer preguntas. Recibes las etapas ya definidas del proyecto en
JSON y debes producir la siguiente etapa.

Reglas generales:
- Las etapas anteriores son la única fuente de verdad. Respeta sus decisiones y usa sus ids
  exactos (ROLE-n, FEAT-n, REQ-n, RULE-n, nombres de tablas, EP-n, SCR-n).
- No agregues funcionalidades fuera del MVP ni omitas ninguna que esté dentro.
- Sé concreto: nada de "A o B", "según se requiera" ni "a definir". Elige y escribe.
- Si falta una decisión imprescindible que no se puede deducir, NO la inventes: agrégala en
  "questions" con isBlocking = true, y en el artefacto usa la opción más conservadora.
  Las decisiones menores con un valor razonable no son preguntas: decídelas tú.
- Escribe en español, salvo identificadores técnicos (tablas, columnas, rutas, campos JSON).

Formato de respuesta, solo este objeto JSON:
{
  "artifact": { ...la etapa, con la forma indicada abajo... },
  "questions": [
    { "text": "", "rationale": "", "affects": ["database"|"backend"|"frontend"|"architecture"], "isBlocking": true|false }
  ]
}
`.trim();

const DATABASE = `
## Etapa: modelo físico de base de datos (PostgreSQL)
- Una entidad por concepto que el producto necesita guardar. Nombres de tablas y columnas en
  snake_case, tablas en plural.
- Cada entidad indica en "supports" los REQ-n o FEAT-n que la justifican.
- Clave primaria "id" de tipo uuid con default gen_random_uuid(), salvo razón clara.
- Tipos físicos de PostgreSQL (uuid, text, varchar(n), integer, numeric(p,s), boolean,
  timestamptz, date, jsonb, geography(Point,4326), etc.).
- Toda clave foránea es una columna de la tabla hija y aparece en "relationships"
  (from = tabla con la FK). Cardinalidad y comportamiento al eliminar explícitos.
- Restricciones CHECK para estados, rangos y reglas de negocio que la base pueda garantizar.
  Índices para claves foráneas y para los filtros y orden que usen los listados.
- Si hay cuentas de usuario, incluye cómo se guardan las credenciales (hash, nunca la
  contraseña) y el rol. Si un requisito pide historial o trazabilidad, modela esa tabla.
- Fechas en timestamptz (UTC). created_at y updated_at donde corresponda.

Forma de "artifact":
{
  "overview": "explicación general del modelo",
  "entities": [{
    "name": "tabla", "description": "", "supports": ["REQ-1"],
    "attributes": [{ "name": "", "type": "", "nullable": false, "primaryKey": false, "unique": false, "default": "opcional", "description": "opcional" }],
    "indexes": [{ "columns": [""], "unique": false }],
    "constraints": ["CHECK (...)"]
  }],
  "relationships": [{ "from": "", "fromColumn": "", "to": "", "toColumn": "id", "cardinality": "1:1"|"1:N"|"N:M", "onDelete": "cascade"|"restrict"|"set null" }]
}
`.trim();

const BACKEND = `
## Etapa: backend y API REST
- Define TODOS los endpoints necesarios para cumplir cada requisito (cada REQ-n debe aparecer
  en al menos un endpoint) y para que cada pantalla futura tenga los datos que necesita.
- Rutas REST con recursos en plural; métodos adecuados (GET leer, POST crear, PATCH actualizar
  parcialmente, PUT reemplazar, DELETE eliminar). Ids de la forma EP-1, EP-2…
- "entities" son tablas del modelo de datos; los campos de entrada y salida deben existir en
  esas tablas o derivarse claramente de ellas.
- Autenticación: requiresAuth = false solo para lo público. allowedRoleIds lista los ROLE-n que
  pueden usarlo; vacío significa "cualquier usuario con sesión".
- Respuestas: el éxito (200, 201 o 204) y cada error posible. 401 si requiere sesión. 403 si
  está restringido a algunos roles o depende de ser dueño del recurso. 404 si recibe un id.
  409 para conflictos (duplicados, estado que no permite la acción, edición concurrente).
  422 para datos con formato correcto pero inválidos según las reglas. 400 para JSON o
  parámetros mal formados.
- Cada parámetro de ruta (":id") se describe en pathParams. Las validaciones citan las
  reglas de negocio (RULE-n) que aplican.
- Lo público nunca devuelve datos privados que la definición protege.
- Paginación por parámetros de consulta en los listados.

Forma de "artifact":
{
  "overview": "", "auth": { "scheme": "", "description": "" },
  "endpoints": [{
    "id": "EP-1", "method": "GET", "path": "/recursos/:id", "summary": "",
    "requiresAuth": true, "allowedRoleIds": ["ROLE-1"], "entities": ["tabla"], "requirementIds": ["REQ-1"],
    "request": {
      "pathParams": [{ "name": "", "type": "", "required": true, "validation": "opcional", "description": "opcional" }],
      "queryParams": [], "headers": [], "body": []
    },
    "responses": [{ "status": 200, "when": "", "body": [{ "name": "", "type": "", "required": true }] }]
  }]
}
`.trim();

const FRONTEND = `
## Etapa: interfaz (pantallas y navegación)
- Pantallas necesarias para que cada rol complete el recorrido principal y para cubrir cada
  funcionalidad del MVP (cada FEAT-n debe estar en al menos una pantalla). Ids SCR-1, SCR-2…
- visibleToRoleIds: ROLE-n que ven la pantalla; vacío significa pantalla pública (sin sesión).
- layout: bloques en orden para un mockup de baja fidelidad. region ∈ header, sidebar, main,
  footer, modal; component ∈ title, text, form, table, list, card, button, nav. En "fields"
  van los campos o columnas que muestra.
- actions: cada acción llama a un endpoint existente (endpointId = EP-n), navega a una
  pantalla (navigatesTo = SCR-n) o ambas. Si solo algunos roles la ven, indica
  visibleToRoleIds, y esos roles deben estar permitidos por el endpoint.
- states: qué se muestra vacío, cargando y con error (texto concreto).
- navigation: todas las transiciones entre pantallas. entryScreenId: la pantalla inicial.
- No agregues pantallas para funcionalidades fuera del MVP. Usa todos los endpoints.

Forma de "artifact":
{
  "entryScreenId": "SCR-1",
  "screens": [{
    "id": "SCR-1", "name": "", "purpose": "", "visibleToRoleIds": [], "featureIds": ["FEAT-1"],
    "layout": [{ "region": "main", "component": "form", "label": "", "fields": [""] }],
    "actions": [{ "label": "", "endpointId": "EP-1", "navigatesTo": "SCR-2", "visibleToRoleIds": ["ROLE-1"] }],
    "states": { "empty": "", "loading": "", "error": "" }
  }],
  "navigation": [{ "from": "SCR-1", "to": "SCR-2", "trigger": "" }]
}
`.trim();

const ARCHITECTURE = `
## Etapa: arquitectura
- Elige UNA arquitectura del catálogo (selectedKey = su "key"). Justifica con características
  concretas del producto, citando REQ-n, RULE-n, volumen de datos, roles e integraciones.
- En "discarded" explica brevemente por qué no conviene cada una de las demás.
- stack: tecnologías concretas, con versión mayor cuando aplique (ej. "PostgreSQL 16 con
  PostGIS 3", "Node.js 22 + TypeScript + Fastify 5 + Drizzle ORM", "React 18 + Vite"). Una sola
  opción por capa, nunca "X o Y". Si el producto guarda archivos subidos por usuarios,
  "fileStorage" dice exactamente dónde y cómo (servicio, bucket, límites); si no, omítelo.
  La base de datos y los tipos deben soportar el modelo de datos ya definido.
- deployment: estrategia concreta, ambientes y TODAS las variables de entorno necesarias
  (incluidos secretos, sin valores).
- observability: logs, métricas, trazabilidad y health checks concretos.
- auth: cómo se valida la identidad, cómo funciona el SSO (o por qué no aplica en el MVP,
  según la definición), cómo se mantiene la sesión o token y cómo el backend decide los
  permisos por rol y por recurso. Debe ser coherente con los endpoints definidos.

Forma de "artifact":
{
  "selectedKey": "", "justification": "",
  "discarded": [{ "key": "", "reason": "" }],
  "stack": { "database": "", "backend": "", "frontend": "", "communication": "", "fileStorage": "opcional" },
  "deployment": { "strategy": "", "environments": [""], "envVars": [{ "name": "", "purpose": "" }] },
  "observability": { "logging": "", "metrics": "", "tracing": "", "healthChecks": "" },
  "auth": { "identity": "", "sso": "", "session": "", "authorization": "" }
}
`.trim();

const BY_STAGE: Record<Exclude<GeneratableStage, "definition">, string> = {
  database: DATABASE,
  backend: BACKEND,
  frontend: FRONTEND,
  architecture: ARCHITECTURE,
};

export function stageSystemPrompt(stage: Exclude<GeneratableStage, "definition">): string {
  return `${COMMON}\n\n${BY_STAGE[stage]}`;
}

/** Etapas anteriores a `stage`, en orden. */
export function previousStages(stage: StageKind): StageKind[] {
  return STAGE_ORDER.slice(0, STAGE_ORDER.indexOf(stage));
}

export function stageContextMessage(
  context: ProjectContext,
  stage: Exclude<GeneratableStage, "definition">,
  catalog: readonly ArchitectureTemplate[],
): string {
  const lines = [
    `# Proyecto: ${context.projectName}`,
    "",
    "## Idea inicial",
    context.initialIdea,
    "",
    "## Decisiones confirmadas por el equipo",
    context.answeredQuestions.length
      ? context.answeredQuestions.map((q) => `- ${q.text} → ${q.answer}`).join("\n")
      : "(ninguna)",
  ];
  for (const s of previousStages(stage)) {
    const artifact = context.stages[s as keyof ProjectContext["stages"]];
    if (artifact) lines.push("", `## Etapa ya definida: ${s}`, JSON.stringify(artifact));
  }
  const current = context.stages[stage];
  if (current) {
    lines.push(
      "",
      `## Versión actual de esta etapa (${stage})`,
      "Mejórala manteniendo lo que el equipo editó, salvo que contradiga las etapas anteriores.",
      JSON.stringify(current),
    );
  }
  if (stage === "architecture") {
    lines.push("", "## Catálogo de arquitecturas base", JSON.stringify(catalog));
  }
  lines.push("", `Genera ahora la etapa "${stage}".`);
  return lines.join("\n");
}
