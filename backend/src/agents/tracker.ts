/**
 * Estado en vivo de los agentes: qué agente está trabajando ahora en cada proyecto. Se guarda en
 * memoria porque solo importa mientras dura la llamada a la IA; lo histórico queda en la
 * auditoría (detail.agent).
 */
import type { AgentId } from "../engine/agents.ts";

export interface AgentRun {
  agent: AgentId;
  task: string;
  userName: string;
  startedAt: string;
}

const running = new Map<string, Map<string, AgentRun>>();

/** Ejecuta `fn` marcando al agente como trabajando en el proyecto mientras dura. */
export async function runAgent<T>(
  projectId: string,
  run: Omit<AgentRun, "startedAt">,
  fn: () => Promise<T>,
): Promise<T> {
  const key = `${run.agent}:${crypto.randomUUID()}`;
  const runs = running.get(projectId) ?? new Map<string, AgentRun>();
  running.set(projectId, runs);
  runs.set(key, { ...run, startedAt: new Date().toISOString() });
  try {
    return await fn();
  } finally {
    runs.delete(key);
    if (runs.size === 0) running.delete(projectId);
  }
}

export function runningAgents(projectId: string): AgentRun[] {
  return [...(running.get(projectId)?.values() ?? [])];
}
