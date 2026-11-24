/**
 * Los agentes de Longanizator. Cada uno es una IA especializada: tiene un rol, sus propias
 * instrucciones, las skills (conocimiento de dominio que se le inyecta) y las tools (validadores
 * y verificaciones en código) con las que se controla su trabajo antes de aceptarlo.
 *
 * Este registro es la fuente para la interfaz (pestaña Agentes) y para la auditoría: cada acción
 * de IA queda registrada con el id de su agente.
 */
import type { StageKind } from "../contracts/artifacts.ts";

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

export interface AgentInfo {
  id: AgentId;
  name: string;
  /** Qué hace, en una frase. */
  role: string;
  /** Etapa en la que trabaja, si es de una etapa. */
  stage: StageKind | null;
  skills: string[];
  tools: string[];
}

export const AGENTS: readonly AgentInfo[] = [
  {
    id: "entrevistador",
    name: "Entrevistador",
    role:
      "Conversa con el equipo, detecta las preguntas bloqueantes y arma la definición del producto.",
    stage: "definition",
    skills: ["Entrevista de producto", "Detección de decisiones bloqueantes"],
    tools: ["Validador de la definición", "Validador de consistencia"],
  },
  {
    id: "arquitecto-datos",
    name: "Arquitecto de datos",
    role: "Diseña el modelo físico de la base de datos a partir de la definición.",
    stage: "database",
    skills: ["Modelado relacional"],
    tools: ["Validador de esquema", "Validador de consistencia"],
  },
  {
    id: "disenador-api",
    name: "Diseñador de API",
    role: "Define cada endpoint con entradas, validaciones, respuestas y códigos de error.",
    stage: "backend",
    skills: ["Diseño de APIs REST"],
    tools: ["Validador de contrato", "Validador de consistencia"],
  },
  {
    id: "disenador-interfaz",
    name: "Diseñador de interfaz",
    role: "Arma las pantallas, la navegación y los permisos por rol de la aplicación.",
    stage: "frontend",
    skills: ["Patrones de interfaz web"],
    tools: ["Validador de navegación y rutas", "Validador de consistencia"],
  },
  {
    id: "arquitecto-soluciones",
    name: "Arquitecto de soluciones",
    role: "Elige una de las cinco arquitecturas base y define stack, despliegue y observabilidad.",
    stage: "architecture",
    skills: ["Catálogo de cinco arquitecturas base"],
    tools: ["Validador de stack", "Validador de consistencia"],
  },
  {
    id: "disenador-visual",
    name: "Diseñador visual",
    role: "Dibuja cómo se vería cada pantalla, con datos de ejemplo coherentes con el modelo.",
    stage: "frontend",
    skills: ["Sistema de diseño de Longanizator", "Patrones de interfaz web"],
    tools: ["Validador de HTML seguro", "Vista previa aislada"],
  },
  {
    id: "auditor",
    name: "Auditor semántico",
    role:
      "Revisa lo que el código no ve: que cada regla y caso borde esté resuelto en la API y en las pantallas.",
    stage: "review",
    skills: ["Auditoría de especificaciones"],
    tools: ["Verificador de referencias (ids citados)"],
  },
  {
    id: "resolvedor",
    name: "Resolvedor",
    role: "Propone el cambio mínimo que cierra una inconsistencia, sin tocar etapas anteriores.",
    stage: "review",
    skills: ["Edición mínima de especificaciones"],
    tools: ["Validador de consistencia (antes y después)"],
  },
  {
    id: "revisor",
    name: "Revisor externo",
    role:
      "Lee los documentos finales como la IA que implementará el producto y lista lo que tendría que inventar.",
    stage: "review",
    skills: ["Lectura de especificaciones como implementador"],
    tools: ["Generador de documentos", "Verificador de referencias (ids citados)"],
  },
];

export function agentById(id: AgentId): AgentInfo {
  return AGENTS.find((a) => a.id === id)!;
}

/** Agente que genera cada etapa. */
export const STAGE_AGENT: Record<Exclude<StageKind, "review">, AgentId> = {
  definition: "entrevistador",
  database: "arquitecto-datos",
  backend: "disenador-api",
  frontend: "disenador-interfaz",
  architecture: "arquitecto-soluciones",
};
