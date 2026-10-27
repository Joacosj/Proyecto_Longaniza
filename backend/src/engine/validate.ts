/**
 * Validación de lo que responde la IA. Cada función lanza un Error con la ruta exacta del
 * problema (ej. "artifactDraft.requirements[2].featureId debe ser texto"). Ese mensaje se le
 * devuelve a la IA para que corrija su respuesta.
 */
import type {
  ArchitectureArtifact,
  BackendArtifact,
  DatabaseArtifact,
  DefinitionArtifact,
  Field,
  FrontendArtifact,
} from "../contracts/artifacts.ts";
import type { NewQuestion } from "./types.ts";

type Obj = Record<string, unknown>;

export function obj(v: unknown, path: string): Obj {
  if (typeof v !== "object" || v === null || Array.isArray(v)) {
    throw new Error(`${path} debe ser un objeto`);
  }
  return v as Obj;
}

export function str(v: unknown, path: string, opts: { allowEmpty?: boolean } = {}): string {
  if (typeof v !== "string") throw new Error(`${path} debe ser texto`);
  if (!opts.allowEmpty && !v.trim()) throw new Error(`${path} no puede estar vacío`);
  return v.trim();
}

export function bool(v: unknown, path: string): boolean {
  if (typeof v !== "boolean") throw new Error(`${path} debe ser true o false`);
  return v;
}

export function num(v: unknown, path: string): number {
  if (typeof v !== "number" || !Number.isFinite(v)) throw new Error(`${path} debe ser un número`);
  return v;
}

export function arr<T>(
  v: unknown,
  path: string,
  item: (x: unknown, p: string) => T,
  opts: { min?: number } = {},
): T[] {
  if (!Array.isArray(v)) throw new Error(`${path} debe ser una lista`);
  if (opts.min && v.length < opts.min) {
    throw new Error(`${path} debe tener al menos ${opts.min} elemento(s)`);
  }
  return v.map((x, i) => item(x, `${path}[${i}]`));
}

export function oneOf<T extends string>(v: unknown, path: string, values: readonly T[]): T {
  if (typeof v !== "string" || !values.includes(v as T)) {
    throw new Error(`${path} debe ser uno de: ${values.join(", ")}`);
  }
  return v as T;
}

export function id(v: unknown, path: string, prefix: string): string {
  const s = str(v, path);
  if (!new RegExp(`^${prefix}-\\d+$`).test(s)) {
    throw new Error(`${path} debe tener el formato ${prefix}-<número> (recibido "${s}")`);
  }
  return s;
}

const strings = (v: unknown, p: string) => arr(v, p, (x, q) => str(x, q));

// ------------------------------------------------------------------ Preguntas
export const AFFECTS = ["database", "backend", "frontend", "architecture"] as const;

export function parseNewQuestion(v: unknown, path: string): NewQuestion {
  const o = obj(v, path);
  const isBlocking = bool(o.isBlocking, `${path}.isBlocking`);
  const affects = arr(o.affects ?? [], `${path}.affects`, (x, p) => oneOf(x, p, AFFECTS));
  if (isBlocking && affects.length === 0) {
    throw new Error(
      `${path} es bloqueante pero affects está vacío: indica qué etapas (database, backend, ` +
        "frontend, architecture) dependen de la respuesta",
    );
  }
  return {
    text: str(o.text, `${path}.text`),
    rationale: str(o.rationale, `${path}.rationale`),
    affects,
    isBlocking,
  };
}

// ------------------------------------------------------------------ Etapa 1
export function parseDefinitionArtifact(v: unknown, path: string): DefinitionArtifact {
  const o = obj(v, path);
  const problem = obj(o.problem, `${path}.problem`);
  const mvp = obj(o.mvp, `${path}.mvp`);

  return {
    problem: {
      statement: str(problem.statement, `${path}.problem.statement`),
      context: str(problem.context, `${path}.problem.context`),
      expectedImprovement: str(problem.expectedImprovement, `${path}.problem.expectedImprovement`),
    },
    userTypes: arr(o.userTypes, `${path}.userTypes`, (x, p) => {
      const r = obj(x, p);
      return {
        id: id(r.id, `${p}.id`, "ROLE"),
        name: str(r.name, `${p}.name`),
        description: str(r.description, `${p}.description`),
        goals: strings(r.goals ?? [], `${p}.goals`),
      };
    }, { min: 1 }),
    expectedOutcomes: strings(o.expectedOutcomes ?? [], `${path}.expectedOutcomes`),
    mvp: {
      included: arr(mvp.included, `${path}.mvp.included`, (x, p) => {
        const f = obj(x, p);
        return {
          id: id(f.id, `${p}.id`, "FEAT"),
          title: str(f.title, `${p}.title`),
          description: str(f.description, `${p}.description`),
        };
      }, { min: 1 }),
      excluded: arr(mvp.excluded ?? [], `${path}.mvp.excluded`, (x, p) => {
        const f = obj(x, p);
        return { title: str(f.title, `${p}.title`), reason: str(f.reason, `${p}.reason`) };
      }),
    },
    mainJourney: arr(o.mainJourney, `${path}.mainJourney`, (x, p) => {
      const s = obj(x, p);
      return {
        step: num(s.step, `${p}.step`),
        actorRoleId: id(s.actorRoleId, `${p}.actorRoleId`, "ROLE"),
        action: str(s.action, `${p}.action`),
        result: str(s.result, `${p}.result`),
      };
    }, { min: 1 }),
    requirements: arr(o.requirements, `${path}.requirements`, (x, p) => {
      const r = obj(x, p);
      return {
        id: id(r.id, `${p}.id`, "REQ"),
        description: str(r.description, `${p}.description`),
        featureId: id(r.featureId, `${p}.featureId`, "FEAT"),
        roleIds: arr(r.roleIds, `${p}.roleIds`, (y, q) => id(y, q, "ROLE"), { min: 1 }),
      };
    }, { min: 1 }),
    businessRules: arr(o.businessRules ?? [], `${path}.businessRules`, (x, p) => {
      const r = obj(x, p);
      return { id: id(r.id, `${p}.id`, "RULE"), rule: str(r.rule, `${p}.rule`) };
    }),
    constraints: strings(o.constraints ?? [], `${path}.constraints`),
    integrations: arr(o.integrations ?? [], `${path}.integrations`, (x, p) => {
      const i = obj(x, p);
      return {
        name: str(i.name, `${p}.name`),
        purpose: str(i.purpose, `${p}.purpose`),
        onFailure: str(i.onFailure, `${p}.onFailure`),
      };
    }),
    security: strings(o.security ?? [], `${path}.security`),
    edgeCases: arr(o.edgeCases ?? [], `${path}.edgeCases`, (x, p) => {
      const e = obj(x, p);
      return {
        situation: str(e.situation, `${p}.situation`),
        expectedBehavior: str(e.expectedBehavior, `${p}.expectedBehavior`),
      };
    }),
  };
}

const optStr = (v: unknown, p: string) =>
  v === undefined || v === null ? undefined : str(v, p, { allowEmpty: true });

// ------------------------------------------------------------------ Etapa 2: base de datos
export function parseDatabaseArtifact(v: unknown, path: string): DatabaseArtifact {
  const o = obj(v, path);
  return {
    overview: str(o.overview, `${path}.overview`),
    entities: arr(o.entities, `${path}.entities`, (x, p) => {
      const e = obj(x, p);
      return {
        name: snake(e.name, `${p}.name`),
        description: str(e.description, `${p}.description`),
        supports: strings(e.supports ?? [], `${p}.supports`),
        attributes: arr(e.attributes, `${p}.attributes`, (y, q) => {
          const a = obj(y, q);
          return {
            name: snake(a.name, `${q}.name`),
            type: str(a.type, `${q}.type`),
            nullable: bool(a.nullable, `${q}.nullable`),
            primaryKey: bool(a.primaryKey, `${q}.primaryKey`),
            unique: bool(a.unique, `${q}.unique`),
            default: optStr(a.default, `${q}.default`),
            description: optStr(a.description, `${q}.description`),
          };
        }, { min: 1 }),
        indexes: arr(e.indexes ?? [], `${p}.indexes`, (y, q) => {
          const i = obj(y, q);
          return {
            columns: arr(i.columns, `${q}.columns`, (z, r) => str(z, r), { min: 1 }),
            unique: bool(i.unique, `${q}.unique`),
          };
        }),
        constraints: strings(e.constraints ?? [], `${p}.constraints`),
      };
    }, { min: 1 }),
    relationships: arr(o.relationships ?? [], `${path}.relationships`, (x, p) => {
      const r = obj(x, p);
      return {
        from: str(r.from, `${p}.from`),
        fromColumn: str(r.fromColumn, `${p}.fromColumn`),
        to: str(r.to, `${p}.to`),
        toColumn: str(r.toColumn, `${p}.toColumn`),
        cardinality: oneOf(r.cardinality, `${p}.cardinality`, ["1:1", "1:N", "N:M"] as const),
        onDelete: oneOf(r.onDelete, `${p}.onDelete`, ["cascade", "restrict", "set null"] as const),
      };
    }),
  };
}

function snake(v: unknown, path: string): string {
  const s = str(v, path);
  if (!/^[a-z][a-z0-9_]*$/.test(s)) {
    throw new Error(`${path} debe estar en snake_case con minúsculas (recibido "${s}")`);
  }
  return s;
}

// ------------------------------------------------------------------ Etapa 3: backend
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
const STATUSES = [200, 201, 204, 400, 401, 403, 404, 409, 422, 500] as const;

function parseField(v: unknown, path: string): Field {
  const f = obj(v, path);
  return {
    name: str(f.name, `${path}.name`),
    type: str(f.type, `${path}.type`),
    required: bool(f.required, `${path}.required`),
    validation: optStr(f.validation, `${path}.validation`),
    description: optStr(f.description, `${path}.description`),
  };
}

export function parseBackendArtifact(v: unknown, path: string): BackendArtifact {
  const o = obj(v, path);
  const auth = obj(o.auth, `${path}.auth`);
  return {
    overview: str(o.overview, `${path}.overview`),
    auth: {
      scheme: str(auth.scheme, `${path}.auth.scheme`),
      description: str(auth.description, `${path}.auth.description`),
    },
    endpoints: arr(o.endpoints, `${path}.endpoints`, (x, p) => {
      const e = obj(x, p);
      const req = obj(e.request ?? {}, `${p}.request`);
      const path_ = str(e.path, `${p}.path`);
      if (!path_.startsWith("/")) {
        throw new Error(`${p}.path debe empezar con "/" (recibido "${path_}")`);
      }
      return {
        id: id(e.id, `${p}.id`, "EP"),
        method: oneOf(e.method, `${p}.method`, METHODS),
        path: path_,
        summary: str(e.summary, `${p}.summary`),
        requiresAuth: bool(e.requiresAuth, `${p}.requiresAuth`),
        allowedRoleIds: arr(
          e.allowedRoleIds ?? [],
          `${p}.allowedRoleIds`,
          (y, q) => id(y, q, "ROLE"),
        ),
        entities: strings(e.entities ?? [], `${p}.entities`),
        requirementIds: arr(
          e.requirementIds ?? [],
          `${p}.requirementIds`,
          (y, q) => id(y, q, "REQ"),
        ),
        request: {
          pathParams: arr(req.pathParams ?? [], `${p}.request.pathParams`, parseField),
          queryParams: arr(req.queryParams ?? [], `${p}.request.queryParams`, parseField),
          headers: arr(req.headers ?? [], `${p}.request.headers`, parseField),
          body: arr(req.body ?? [], `${p}.request.body`, parseField),
        },
        responses: arr(e.responses, `${p}.responses`, (y, q) => {
          const r = obj(y, q);
          const status = num(r.status, `${q}.status`);
          if (!(STATUSES as readonly number[]).includes(status)) {
            throw new Error(`${q}.status debe ser uno de: ${STATUSES.join(", ")}`);
          }
          return {
            status: status as (typeof STATUSES)[number],
            when: str(r.when, `${q}.when`),
            body: arr(r.body ?? [], `${q}.body`, parseField),
          };
        }, { min: 1 }),
      };
    }, { min: 1 }),
  };
}

// ------------------------------------------------------------------ Etapa 4: frontend
const REGIONS = ["header", "sidebar", "main", "footer", "modal"] as const;
const COMPONENTS = ["title", "text", "form", "table", "list", "card", "button", "nav"] as const;

export function parseFrontendArtifact(v: unknown, path: string): FrontendArtifact {
  const o = obj(v, path);
  return {
    entryScreenId: id(o.entryScreenId, `${path}.entryScreenId`, "SCR"),
    screens: arr(o.screens, `${path}.screens`, (x, p) => {
      const s = obj(x, p);
      const states = obj(s.states, `${p}.states`);
      return {
        id: id(s.id, `${p}.id`, "SCR"),
        name: str(s.name, `${p}.name`),
        purpose: str(s.purpose, `${p}.purpose`),
        visibleToRoleIds: arr(
          s.visibleToRoleIds ?? [],
          `${p}.visibleToRoleIds`,
          (y, q) => id(y, q, "ROLE"),
        ),
        featureIds: arr(s.featureIds ?? [], `${p}.featureIds`, (y, q) => id(y, q, "FEAT")),
        layout: arr(s.layout, `${p}.layout`, (y, q) => {
          const b = obj(y, q);
          return {
            region: oneOf(b.region, `${q}.region`, REGIONS),
            component: oneOf(b.component, `${q}.component`, COMPONENTS),
            label: str(b.label, `${q}.label`),
            fields: b.fields === undefined ? undefined : strings(b.fields, `${q}.fields`),
          };
        }, { min: 1 }),
        actions: arr(s.actions ?? [], `${p}.actions`, (y, q) => {
          const a = obj(y, q);
          const endpointId = a.endpointId == null
            ? undefined
            : id(a.endpointId, `${q}.endpointId`, "EP");
          const navigatesTo = a.navigatesTo == null
            ? undefined
            : id(a.navigatesTo, `${q}.navigatesTo`, "SCR");
          if (!endpointId && !navigatesTo) {
            throw new Error(`${q} debe tener endpointId, navigatesTo o ambos`);
          }
          return {
            label: str(a.label, `${q}.label`),
            endpointId,
            navigatesTo,
            visibleToRoleIds: a.visibleToRoleIds == null
              ? undefined
              : arr(a.visibleToRoleIds, `${q}.visibleToRoleIds`, (z, r) => id(z, r, "ROLE")),
          };
        }),
        states: {
          empty: str(states.empty, `${p}.states.empty`),
          loading: str(states.loading, `${p}.states.loading`),
          error: str(states.error, `${p}.states.error`),
        },
      };
    }, { min: 1 }),
    navigation: arr(o.navigation ?? [], `${path}.navigation`, (x, p) => {
      const n = obj(x, p);
      const trigger = str(n.trigger, `${p}.trigger`);
      if (trigger.length > 60) {
        throw new Error(
          `${p}.trigger debe ser breve (máximo 60 caracteres, recibido ${trigger.length})`,
        );
      }
      return { from: id(n.from, `${p}.from`, "SCR"), to: id(n.to, `${p}.to`, "SCR"), trigger };
    }),
  };
}

// ------------------------------------------------------------------ Etapa 5: arquitectura
const STACK_MAX = 160;

/** Las capas del stack son nombres de tecnologías, no explicaciones. */
function short(v: unknown, path: string): string {
  const s = str(v, path);
  if (s.length > STACK_MAX) {
    throw new Error(
      `${path} tiene ${s.length} caracteres: debe ser solo la lista de tecnologías con su ` +
        `versión (máximo ${STACK_MAX}); mueve los detalles a justification, deployment o auth`,
    );
  }
  if (/\b\w[\w.-]* 0(?![.\d])/.test(s)) {
    throw new Error(`${path} tiene una versión "0" incompleta: indica la versión menor (ej. 0.36)`);
  }
  return s;
}
export function parseArchitectureArtifact(v: unknown, path: string): ArchitectureArtifact {
  const o = obj(v, path);
  const stack = obj(o.stack, `${path}.stack`);
  const dep = obj(o.deployment, `${path}.deployment`);
  const obs = obj(o.observability, `${path}.observability`);
  const auth = obj(o.auth, `${path}.auth`);
  const fileStorage = optStr(stack.fileStorage, `${path}.stack.fileStorage`);
  return {
    selectedKey: str(o.selectedKey, `${path}.selectedKey`),
    justification: str(o.justification, `${path}.justification`),
    discarded: arr(o.discarded ?? [], `${path}.discarded`, (x, p) => {
      const d = obj(x, p);
      return { key: str(d.key, `${p}.key`), reason: str(d.reason, `${p}.reason`) };
    }),
    stack: {
      database: short(stack.database, `${path}.stack.database`),
      backend: short(stack.backend, `${path}.stack.backend`),
      frontend: short(stack.frontend, `${path}.stack.frontend`),
      communication: short(stack.communication, `${path}.stack.communication`),
      ...(fileStorage ? { fileStorage } : {}),
    },
    deployment: {
      strategy: str(dep.strategy, `${path}.deployment.strategy`),
      environments: arr(dep.environments, `${path}.deployment.environments`, (x, p) => str(x, p), {
        min: 1,
      }),
      envVars: arr(dep.envVars ?? [], `${path}.deployment.envVars`, (x, p) => {
        const e = obj(x, p);
        return { name: str(e.name, `${p}.name`), purpose: str(e.purpose, `${p}.purpose`) };
      }),
    },
    observability: {
      logging: str(obs.logging, `${path}.observability.logging`),
      metrics: str(obs.metrics, `${path}.observability.metrics`),
      tracing: str(obs.tracing, `${path}.observability.tracing`),
      healthChecks: str(obs.healthChecks, `${path}.observability.healthChecks`),
    },
    auth: {
      identity: str(auth.identity, `${path}.auth.identity`),
      sso: str(auth.sso, `${path}.auth.sso`),
      session: str(auth.session, `${path}.auth.session`),
      authorization: str(auth.authorization, `${path}.auth.authorization`),
    },
  };
}
