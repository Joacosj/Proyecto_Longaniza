/**
 * Validación de lo que responde la IA. Cada función lanza un Error con la ruta exacta del
 * problema (ej. "artifactDraft.requirements[2].featureId debe ser texto"). Ese mensaje se le
 * devuelve a la IA para que corrija su respuesta.
 */
import type { DefinitionArtifact } from "../contracts/artifacts.ts";
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
