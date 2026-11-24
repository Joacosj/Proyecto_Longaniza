/**
 * Estado en vivo de los agentes: qué agente está trabajando ahora en cada proyecto. Se guarda en
 * memoria porque solo importa mientras dura la llamada a la IA; lo histórico queda en la
 * auditoría (detail.agent).
 */
import type { AgentId } from "../engine/agents.ts";
import { ApiError } from "../http/errors.ts";

export interface AgentRun {
  agent: AgentId;
  task: string;
  userName: string;
  /**
   * Sobre qué trabaja (por ejemplo "stage:database" o "preview:SCR-2"). Sirve para que la
   * interfaz retome el estado si el usuario cambia de página mientras el agente trabaja, y
   * para no lanzar dos veces el mismo trabajo a la vez.
   */
  target?: string;
  startedAt: string;
}

const running = new Map<string, Map<string, AgentRun>>();

/**
 * Ejecuta `fn` marcando al agente como trabajando en el proyecto mientras dura. El trabajo
 * sigue aunque el usuario cierre o cambie la página: el resultado se guarda igual.
 */
export async function runAgent<T>(
  projectId: string,
  run: Omit<AgentRun, "startedAt">,
  fn: () => Promise<T>,
): Promise<T> {
  if (run.target) assertIdle(projectId, run.target);
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

/** Responde 409 si ya hay un agente trabajando sobre `target` en el proyecto. */
export function assertIdle(projectId: string, target: string): void {
  const busy = runningAgents(projectId).find((r) => r.target === target);
  if (busy) {
    throw new ApiError(
      "CONFLICT",
      `Ya se está trabajando en esto (lo pidió ${busy.userName}). Espera a que termine.`,
      { target },
    );
  }
}

export function runningAgents(projectId: string): AgentRun[] {
  return [...(running.get(projectId)?.values() ?? [])];
}
