/** Tipos de las respuestas de la API (ver docs/api-contrato.md). */

export type ProjectRole = "owner" | "editor" | "viewer";

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

export const STAGE_LABEL: Record<StageKind, string> = {
  definition: "Definición",
  database: "Base de datos",
  backend: "Backend",
  frontend: "Frontend",
  architecture: "Arquitectura",
  review: "Revisión",
};

export const ROLE_LABEL: Record<ProjectRole, string> = {
  owner: "Owner",
  editor: "Editor",
  viewer: "Lector",
};

export type StageStatus = "locked" | "in_progress" | "approved";

export interface User {
  id: string;
  email: string;
  name: string;
}

export interface UserRef {
  id: string;
  name: string;
}

export interface Project {
  id: string;
  name: string;
  initialIdea: string;
  createdBy: string;
  currentStage: StageKind;
  status: "in_progress" | "ready" | "generated";
  createdAt: string;
  updatedAt: string;
  role: ProjectRole;
}

export interface Member {
  userId: string;
  name: string;
  email: string;
  role: ProjectRole;
  addedAt: string;
}

export interface Invitation {
  id: string;
  email: string;
  role: "editor" | "viewer";
  status: string;
  expiresAt: string;
  createdAt: string;
}

export interface StageSummary {
  kind: StageKind;
  status: StageStatus;
  version: number;
  updatedAt: string;
  updatedBy: UserRef | null;
  approvedAt: string | null;
  approvedBy: UserRef | null;
}

export interface Stage extends StageSummary {
  artifact: Record<string, unknown>;
}

export interface StageVersion {
  version: number;
  source: "ai" | "user";
  artifact: Record<string, unknown>;
  createdAt: string;
  createdBy: UserRef | null;
}

export interface Message {
  id: string;
  stageKind: StageKind;
  role: "user" | "assistant";
  content: string;
  user: UserRef | null;
  createdAt: string;
}

export interface Question {
  id: string;
  stageKind: StageKind;
  text: string;
  rationale: string;
  affects: string[];
  isBlocking: boolean;
  status: "open" | "answered" | "deferred";
  answer: string | null;
  answeredBy: UserRef | null;
  answeredAt: string | null;
  createdAt: string;
}

export interface Inconsistency {
  /** validator: validador en código. auditor: Auditor semántico (IA). */
  source?: "validator" | "auditor";
  id: string;
  stages: StageKind[];
  description: string;
  severity: "critical" | "warning";
  status: "open" | "resolved";
  resolvedBy: UserRef | null;
  resolvedAt: string | null;
}

export type DocumentKind = "product_spec" | "architecture";

export interface DocumentInfo {
  kind: DocumentKind;
  version: number;
  createdAt: string;
  generatedBy: UserRef;
}

export interface Pending {
  unapprovedStages: StageKind[];
  blockingQuestions: { id: string; stageKind: StageKind; text: string }[];
  criticalInconsistencies: { id: string; stages: StageKind[]; description: string }[];
}

export interface Review {
  stages: StageSummary[];
  pending: Pending;
  canGenerateDocuments: boolean;
  inconsistencies: Inconsistency[];
  documents: DocumentInfo[];
}

export interface AuditEntry {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  detail: Record<string, unknown>;
  createdAt: string;
  user: UserRef | null;
}

export interface Architecture {
  key: string;
  name: string;
  summary: string;
}

/** Props que reciben los componentes de `src/stages/`. */
export interface StageComponentProps<A = Record<string, unknown>> {
  artifact: A;
  editable: boolean;
  onChange: (artifact: A) => void;
  /** Extra, por si un componente necesita llamar a la API (ej. el chat de definición). */
  projectId?: string;
}

/** Propuesta de "Resolver con IA" para una inconsistencia. */
export type Resolution =
  | {
    kind: "fix";
    stage: StageKind;
    artifact: Record<string, unknown>;
    summary: string;
    baseVersion: number;
    wasApproved: boolean;
    changes: string[];
  }
  | { kind: "manual"; stage: StageKind | null; explanation: string };

export type AgentId =
  | "entrevistador"
  | "arquitecto-datos"
  | "disenador-api"
  | "disenador-interfaz"
  | "arquitecto-soluciones"
  | "disenador-visual"
  | "auditor"
  | "resolvedor"
  | "revisor";

export interface AgentStatus {
  id: AgentId;
  name: string;
  role: string;
  stage: StageKind | null;
  skills: string[];
  tools: string[];
  working: { task: string; userName: string; target?: string; startedAt: string }[];
  lastAction: { action: string; entityId: string | null; createdAt: string; userName: string | null } | null;
}

/** Nombre del agente que trabaja cada etapa (igual que en el backend). */
export const STAGE_AGENT_NAME: Record<Exclude<StageKind, "review">, string> = {
  definition: "Entrevistador",
  database: "Arquitecto de datos",
  backend: "Diseñador de API",
  frontend: "Diseñador de interfaz",
  architecture: "Arquitecto de soluciones",
};

export const AGENT_NAME: Record<AgentId, string> = {
  entrevistador: "Entrevistador",
  "arquitecto-datos": "Arquitecto de datos",
  "disenador-api": "Diseñador de API",
  "disenador-interfaz": "Diseñador de interfaz",
  "arquitecto-soluciones": "Arquitecto de soluciones",
  "disenador-visual": "Diseñador visual",
  auditor: "Auditor semántico",
  resolvedor: "Resolvedor",
  revisor: "Revisor externo",
};

export interface ScreenPreview {
  screenId: string;
  html: string;
  createdAt: string;
  createdBy: string | null;
}
