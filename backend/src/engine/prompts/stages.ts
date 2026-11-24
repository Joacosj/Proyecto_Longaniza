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
import { PATRONES_INTERFAZ } from "../skills/patrones_interfaz.ts";

const COMMON = `
Eres el arquitecto de software de Longanizator. Longanizator convierte una idea en una especificación que
otra IA implementará SIN poder hacer preguntas. Recibes las etapas ya definidas del proyecto en
JSON y debes producir la siguiente etapa.

Reglas generales:
- Prefiere SIEMPRE la solución más simple que cumpla los requisitos. Esto es un MVP que otra IA
  implementará de una vez: cada mecanismo extra es una oportunidad de error. No agregues
  complejidad que nadie pidió (idempotencia, hashes canónicos, triggers con lógica, colas,
  cachés) salvo que un requisito o regla la exija explícitamente.
- Las tareas del equipo técnico que no tienen pantalla (crear cuentas iniciales, cargar
  configuración, consultas excepcionales) se resuelven como comandos de línea del mismo backend
  que usan sus servicios y su base de datos directamente. No crees endpoints HTTP, sockets ni
  protocolos especiales para ellas, y describe cada comando: nombre, argumentos y resultado.
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
- Los ids de la especificación (ROLE-1, FEAT-2…) son referencias del documento, NO valores a
  guardar: roles, estados y categorías se guardan con códigos legibles en minúsculas
  ("vecino", "en_gestion"), indicando su equivalencia en la descripción.
- La lógica de negocio (permisos, transiciones, validaciones con contexto) va en el backend.
  En la base usa solo restricciones declarativas simples: NOT NULL, UNIQUE, FK, CHECK. No uses
  triggers ni funciones salvo que sea imprescindible.

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
- Describe en "overview" el formato único de error (ej. { "error": { "code", "message" } }) y
  úsalo igual en todos los endpoints.
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
- route: ruta del navegador de cada pantalla, única (ej. "/app/reportes/:id"). Si la pantalla
  recibe un id, va como parámetro de la ruta. Las rutas de pantallas no pueden coincidir con
  rutas de la API; usa un prefijo propio (como /app) si comparten dominio.
- visibleToRoleIds: ROLE-n que ven la pantalla; vacío significa pantalla pública (sin sesión).
- layout: bloques en orden para un mockup de baja fidelidad. region ∈ header, sidebar, main,
  footer, modal; component ∈ title, text, form, table, list, card, button, nav. En "fields"
  van los campos o columnas que muestra.
- actions: cada acción llama a un endpoint existente (endpointId = EP-n), navega a una
  pantalla (navigatesTo = SCR-n) o ambas. Si solo algunos roles la ven, indica
  visibleToRoleIds, y esos roles deben estar permitidos por el endpoint.
- states: qué se muestra vacío, cargando y con error (texto concreto y breve).
- navigation: las transiciones principales entre pantallas, una por par de pantallas, con un
  "trigger" corto (máximo 6 palabras, ej. "Pulsa Crear reporte"). No describas aquí casos de
  error ni retornos genéricos (como volver al inicio al cerrar sesión): eso va en la pantalla.
  entryScreenId: la pantalla inicial.
- No agregues pantallas para funcionalidades fuera del MVP. Usa todos los endpoints.
- Si la definición dice que una funcionalidad se opera fuera de la aplicación (un comando de
  despliegue, una herramienta interna del equipo técnico), no inventes una pantalla: inclúyela
  en "featuresWithoutScreen" con su FEAT-n y una frase que diga cómo se opera.

Forma de "artifact":
{
  "entryScreenId": "SCR-1",
  "screens": [{
    "id": "SCR-1", "name": "", "route": "/app", "purpose": "", "visibleToRoleIds": [], "featureIds": ["FEAT-1"],
    "layout": [{ "region": "main", "component": "form", "label": "", "fields": [""] }],
    "actions": [{ "label": "", "endpointId": "EP-1", "navigatesTo": "SCR-2", "visibleToRoleIds": ["ROLE-1"] }],
    "states": { "empty": "", "loading": "", "error": "" }
  }],
  "navigation": [{ "from": "SCR-1", "to": "SCR-2", "trigger": "" }],
  "featuresWithoutScreen": [{ "featureId": "FEAT-5", "reason": "cómo se opera, en una frase" }]
}
(featuresWithoutScreen va vacío [] si todas las funcionalidades tienen pantalla.)
`.trim();

const ARCHITECTURE = `
## Etapa: arquitectura
- Elige UNA arquitectura del catálogo (selectedKey = su "key"). Justifica con características
  concretas del producto, citando REQ-n, RULE-n, volumen de datos, roles e integraciones.
- En "discarded" explica brevemente por qué no conviene cada una de las demás.
- stack: SOLO nombres de tecnologías con su versión, en una línea corta por capa (máximo ~120
  caracteres), ej. "PostgreSQL 16 + PostGIS 3.4", "Node.js 22 + TypeScript 5 + Fastify 5 +
  Drizzle ORM 0.36", "React 18 + Vite 5". Para librerías en versión 0.x indica la versión
  menor (0.36), nunca "0". Una sola opción por capa, nunca "X o Y". Los detalles de uso
  (límites, parámetros, librerías auxiliares) van en la justificación, el despliegue o la
  autenticación, no en el stack. Si el producto guarda archivos subidos por usuarios,
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
  frontend: `${FRONTEND}\n\n${PATRONES_INTERFAZ}`,
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
