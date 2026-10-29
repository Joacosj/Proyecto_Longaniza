/**
 * Formato del JSON que cada etapa guarda en `stages.artifact`.
 *
 * Este archivo es el acuerdo entre las tres épicas: cada etapa lee los artefactos de las
 * anteriores y escribe el suyo. Cambiarlo requiere avisar al resto del grupo.
 *
 * Regla general: las referencias entre etapas se hacen por `id` (ej. "REQ-3", "users"),
 * nunca por texto libre. Eso es lo que permite validar la consistencia automáticamente.
 */

export type StageKind =
  | "definition"
  | "database"
  | "backend"
  | "frontend"
  | "architecture"
  | "review";

export const STAGE_ORDER: StageKind[] = [
  "definition",
  "database",
  "backend",
  "frontend",
  "architecture",
  "review",
];

// ------------------------------------------------------------------ 1. Definición
export interface DefinitionArtifact {
  problem: { statement: string; context: string; expectedImprovement: string };
  userTypes: {
    id: string; // "ROLE-1"
    name: string;
    description: string;
    goals: string[];
  }[];
  expectedOutcomes: string[];
  mvp: {
    included: { id: string; title: string; description: string }[]; // "FEAT-1"
    excluded: { title: string; reason: string }[];
  };
  mainJourney: { step: number; actorRoleId: string; action: string; result: string }[];
  requirements: {
    id: string; // "REQ-1"
    description: string;
    featureId: string;
    roleIds: string[];
  }[];
  businessRules: { id: string; rule: string }[]; // "RULE-1"
  constraints: string[];
  integrations: { name: string; purpose: string; onFailure: string }[];
  security: string[];
  /** Qué pasa cuando falta información, no hay permisos, el recurso no existe, etc. */
  edgeCases: { situation: string; expectedBehavior: string }[];
}

// ------------------------------------------------------------------ 2. Base de datos
export interface DatabaseArtifact {
  overview: string;
  entities: {
    name: string; // nombre de tabla, sirve de id: "orders"
    description: string;
    /** Requisitos o funcionalidades que justifican la entidad. */
    supports: string[]; // ["REQ-1", "FEAT-2"]
    attributes: {
      name: string;
      type: string; // tipo físico: "uuid", "text", "integer", "timestamptz"...
      nullable: boolean;
      primaryKey: boolean;
      unique: boolean;
      default?: string;
      description?: string;
    }[];
    indexes: { columns: string[]; unique: boolean }[];
    constraints: string[]; // CHECK y otras reglas en texto
  }[];
  relationships: {
    from: string; // entidad que tiene la clave foránea
    fromColumn: string;
    to: string;
    toColumn: string;
    cardinality: "1:1" | "1:N" | "N:M";
    onDelete: "cascade" | "restrict" | "set null";
  }[];
}

// ------------------------------------------------------------------ 3. Backend / API
export interface BackendArtifact {
  overview: string;
  auth: { scheme: string; description: string };
  endpoints: {
    id: string; // "EP-1"
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
    path: string; // "/orders/:id"
    summary: string;
    requiresAuth: boolean;
    allowedRoleIds: string[]; // roles de la etapa 1; vacío = cualquier autenticado
    entities: string[]; // entidades de la etapa 2 que usa
    requirementIds: string[];
    request: {
      pathParams: Field[];
      queryParams: Field[];
      headers: Field[];
      body: Field[];
    };
    responses: {
      status: 200 | 201 | 204 | 400 | 401 | 403 | 404 | 409 | 422 | 500;
      when: string;
      body: Field[];
    }[];
  }[];
}

export interface Field {
  name: string;
  type: string;
  required: boolean;
  validation?: string;
  description?: string;
}

// ------------------------------------------------------------------ 4. Frontend
export interface FrontendArtifact {
  screens: {
    id: string; // "SCR-1"
    name: string;
    /** Ruta del navegador, ej. "/app/reservas/:id". Opcional en proyectos antiguos. */
    route?: string;
    purpose: string;
    visibleToRoleIds: string[];
    featureIds: string[];
    /** Bloques de la pantalla, en orden, para dibujar el mockup de baja fidelidad. */
    layout: {
      region: "header" | "sidebar" | "main" | "footer" | "modal";
      component: "title" | "text" | "form" | "table" | "list" | "card" | "button" | "nav";
      label: string;
      fields?: string[];
    }[];
    actions: {
      label: string;
      endpointId?: string; // endpoint de la etapa 3 que invoca
      navigatesTo?: string; // id de pantalla
      visibleToRoleIds?: string[];
    }[];
    states: { empty: string; loading: string; error: string };
  }[];
  /** Mapa de navegación entre pantallas. */
  navigation: { from: string; to: string; trigger: string }[];
  /**
   * Funcionalidades que se operan fuera de la interfaz (comandos de despliegue, herramientas
   * internas). Cada una explica cómo se usa; sin esto, toda FEAT-n debe estar en una pantalla.
   */
  featuresWithoutScreen?: { featureId: string; reason: string }[];
  entryScreenId: string;
}

// ------------------------------------------------------------------ 5. Arquitectura
export interface ArchitectureTemplate {
  key: string;
  name: string;
  summary: string;
  bestFor: string[];
  notRecommendedWhen: string[];
  persistence: string;
  backend: string;
  frontend: string;
  communication: string; // REST, GraphQL, WebSockets...
  infrastructure: string;
  operation: string;
  auth: string;
}

export interface ArchitectureArtifact {
  selectedKey: string;
  /** Por qué esta arquitectura calza con este producto, citando decisiones previas. */
  justification: string;
  discarded: { key: string; reason: string }[];
  stack: {
    database: string;
    backend: string;
    frontend: string;
    communication: string;
    /** Dónde se guardan archivos subidos por usuarios (fotos, adjuntos). Omitir si no hay. */
    fileStorage?: string;
  };
  deployment: {
    strategy: string;
    environments: string[];
    envVars: { name: string; purpose: string }[];
  };
  observability: { logging: string; metrics: string; tracing: string; healthChecks: string };
  auth: { identity: string; sso: string; session: string; authorization: string };
}

// ------------------------------------------------------------------ Tipos por etapa
export interface ArtifactByStage {
  definition: DefinitionArtifact;
  database: DatabaseArtifact;
  backend: BackendArtifact;
  frontend: FrontendArtifact;
  architecture: ArchitectureArtifact;
  review: Record<string, never>;
}
