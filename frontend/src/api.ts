/** Cliente de la API. Todas las pantallas deben pasar por aquí. */
import type {
  Architecture,
  AuditEntry,
  DocumentInfo,
  DocumentKind,
  Inconsistency,
  Invitation,
  Member,
  Message,
  Project,
  ProjectRole,
  Question,
  Review,
  Stage,
  StageKind,
  StageSummary,
  StageVersion,
  User,
} from "./types";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    credentials: "include",
    ...init,
    headers: { "Content-Type": "application/json", ...init.headers },
  });

  if (res.status === 204) return undefined as T;

  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(
      res.status,
      body?.error?.code ?? "INTERNAL",
      body?.error?.message ?? "Error inesperado",
      body?.error?.details,
    );
  }
  return body as T;
}

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  body: body === undefined ? undefined : JSON.stringify(body),
});

const p = (projectId: string) => `/projects/${projectId}`;

/** Detalles de un 409 por edición concurrente. */
export interface VersionConflict {
  currentVersion: number;
  updatedBy: string | null;
}

export function isVersionConflict(err: unknown): err is ApiError & { details: VersionConflict } {
  return err instanceof ApiError && err.status === 409 &&
    typeof (err.details as VersionConflict | undefined)?.currentVersion === "number";
}

export const client = {
  auth: {
    me: () => api<{ user: User }>("/auth/me"),
    login: (email: string, password: string) =>
      api<{ user: User }>("/auth/login", json("POST", { email, password })),
    register: (email: string, name: string, password: string) =>
      api<{ user: User }>("/auth/register", json("POST", { email, name, password })),
    logout: () => api<void>("/auth/logout", json("POST")),
    ssoProviders: () => api<{ providers: string[] }>("/auth/sso/providers"),
    /** Navegación completa (no fetch): el proveedor necesita redirigir al navegador. */
    ssoStartUrl: (provider: string, next?: string) =>
      `/api/auth/sso/${provider}/start${next ? `?next=${encodeURIComponent(next)}` : ""}`,
  },

  projects: {
    list: () => api<{ projects: Project[] }>("/projects"),
    get: (id: string) => api<{ project: Project }>(p(id)),
    create: (name: string, initialIdea: string) =>
      api<{ project: Project }>("/projects", json("POST", { name, initialIdea })),
    update: (id: string, changes: { name?: string; initialIdea?: string }) =>
      api<{ project: Project }>(p(id), json("PATCH", changes)),
    remove: (id: string) => api<void>(p(id), json("DELETE")),
    audit: (id: string) => api<{ entries: AuditEntry[] }>(`${p(id)}/audit`),
  },

  members: {
    list: (id: string) => api<{ members: Member[] }>(`${p(id)}/members`),
    setRole: (id: string, userId: string, role: ProjectRole) =>
      api<{ member: Member }>(`${p(id)}/members/${userId}`, json("PATCH", { role })),
    remove: (id: string, userId: string) =>
      api<void>(`${p(id)}/members/${userId}`, json("DELETE")),
    invitations: (id: string) => api<{ invitations: Invitation[] }>(`${p(id)}/invitations`),
    invite: (id: string, email: string, role: "editor" | "viewer") =>
      api<{ invitation: Invitation; token: string; acceptPath: string }>(
        `${p(id)}/invitations`,
        json("POST", { email, role }),
      ),
    accept: (token: string) =>
      api<{ projectId: string; role: ProjectRole }>(
        `/invitations/${encodeURIComponent(token)}/accept`,
        json("POST"),
      ),
  },

  stages: {
    list: (id: string) => api<{ stages: StageSummary[] }>(`${p(id)}/stages`),
    get: (id: string, kind: StageKind) => api<{ stage: Stage }>(`${p(id)}/stages/${kind}`),
    save: (id: string, kind: StageKind, version: number, artifact: unknown) =>
      api<{ stage: Stage }>(`${p(id)}/stages/${kind}`, json("PUT", { version, artifact })),
    approve: (id: string, kind: StageKind, version: number) =>
      api<{ stage: Stage }>(`${p(id)}/stages/${kind}/approve`, json("POST", { version })),
    generate: (id: string, kind: StageKind, version: number) =>
      api<{ stage: Stage; questions: Question[] }>(
        `${p(id)}/stages/${kind}/generate`,
        json("POST", { version }),
      ),
    versions: (id: string, kind: StageKind) =>
      api<{ versions: StageVersion[] }>(`${p(id)}/stages/${kind}/versions`),
  },

  dialog: {
    messages: (id: string, stage: StageKind) =>
      api<{ messages: Message[] }>(`${p(id)}/messages?stage=${stage}`),
    send: (id: string, stage: StageKind, content: string) =>
      api<{ message: Message; reply: Message; questions: Question[]; artifactDraft: unknown }>(
        `${p(id)}/messages`,
        json("POST", { stage, content }),
      ),
    questions: (id: string, stage?: StageKind) =>
      api<{ questions: Question[] }>(`${p(id)}/questions${stage ? `?stage=${stage}` : ""}`),
    answer: (id: string, questionId: string, answer: string) =>
      api<{ question: Question }>(`${p(id)}/questions/${questionId}`, json("PATCH", { answer })),
    setQuestionStatus: (id: string, questionId: string, status: "deferred" | "open") =>
      api<{ question: Question }>(`${p(id)}/questions/${questionId}`, json("PATCH", { status })),
  },

  review: {
    get: (id: string) => api<Review>(`${p(id)}/review`),
    check: (id: string) =>
      api<{ added: number; autoResolved: number; inconsistencies: Inconsistency[] }>(
        `${p(id)}/consistency-check`,
        json("POST"),
      ),
    resolve: (id: string, incId: string) =>
      api<{ inconsistency: Inconsistency }>(
        `${p(id)}/inconsistencies/${incId}`,
        json("PATCH", { status: "resolved" }),
      ),
    generateDocuments: (id: string) =>
      api<{ version: number; documents: DocumentInfo[] }>(`${p(id)}/documents`, json("POST")),
    documentUrl: (id: string, kind: DocumentKind, version?: number) =>
      `/api${p(id)}/documents/${kind}${version ? `?version=${version}` : ""}`,
  },

  architectures: () => api<{ architectures: Architecture[] }>("/architectures"),
};
