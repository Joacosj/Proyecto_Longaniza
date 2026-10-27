/**
 * Motor falso para que la mitad A pueda construir y probar rutas y pantallas sin esperar a la
 * mitad B. Devuelve datos fijos y válidos según contracts/artifacts.ts.
 * Se reemplaza por el motor real en main.ts cuando la mitad B lo entregue.
 */
import type { ArtifactByStage } from "../contracts/artifacts.ts";
import type { Engine, GeneratableStage } from "./types.ts";
import { listArchitectures } from "./architectures.ts";

const SAMPLE: { [K in GeneratableStage]: ArtifactByStage[K] } = {
  definition: {
    problem: {
      statement: "Ejemplo: los vecinos no tienen cómo reportar problemas del barrio.",
      context: "Comuna urbana",
      expectedImprovement: "Reportes centralizados y con seguimiento",
    },
    userTypes: [{ id: "ROLE-1", name: "Vecino", description: "Reporta problemas", goals: [] }],
    expectedOutcomes: [],
    mvp: { included: [{ id: "FEAT-1", title: "Crear reporte", description: "" }], excluded: [] },
    mainJourney: [{
      step: 1,
      actorRoleId: "ROLE-1",
      action: "Crea un reporte",
      result: "Queda registrado",
    }],
    requirements: [{
      id: "REQ-1",
      description: "Crear reportes",
      featureId: "FEAT-1",
      roleIds: ["ROLE-1"],
    }],
    businessRules: [],
    constraints: [],
    integrations: [],
    security: [],
    edgeCases: [],
  },
  database: {
    overview: "Ejemplo",
    entities: [{
      name: "reports",
      description: "Reportes",
      supports: ["REQ-1"],
      attributes: [{ name: "id", type: "uuid", nullable: false, primaryKey: true, unique: true }],
      indexes: [],
      constraints: [],
    }],
    relationships: [],
  },
  backend: { overview: "Ejemplo", auth: { scheme: "cookie", description: "" }, endpoints: [] },
  frontend: { screens: [], navigation: [], entryScreenId: "" },
  architecture: {
    selectedKey: "modular-monolith",
    justification: "Ejemplo",
    discarded: [],
    stack: { database: "PostgreSQL", backend: "Deno", frontend: "React", communication: "REST" },
    deployment: { strategy: "Docker Compose", environments: ["dev"], envVars: [] },
    observability: { logging: "", metrics: "", tracing: "", healthChecks: "" },
    auth: { identity: "", sso: "", session: "", authorization: "" },
  },
};

export function createFakeEngine(): Engine {
  return {
    converse: ({ stage, userMessage }) =>
      Promise.resolve({
        reply: `(motor falso) Recibí: "${userMessage}"`,
        newQuestions: stage === "definition"
          ? [{
            text: "¿Los reportes deben ser anónimos?",
            rationale: "Cambia el modelo de usuarios y los permisos",
            affects: ["database", "backend"],
            isBlocking: true,
          }]
          : [],
      }),
    generate: <K extends GeneratableStage>({ stage }: { stage: K }) =>
      Promise.resolve({
        artifact: structuredClone(SAMPLE[stage]) as ArtifactByStage[K],
        questions: [],
      }),
    checkConsistency: () => [],
    renderDocuments: (ctx) => ({
      productSpec: `# ${ctx.projectName}\n\n(documento de ejemplo)\n`,
      architecture: `# Arquitectura de ${ctx.projectName}\n\n(documento de ejemplo)\n`,
    }),
    listArchitectures,
  };
}
