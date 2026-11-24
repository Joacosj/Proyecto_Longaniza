import { useEffect, useRef, useState } from "react";
import { client } from "./api";

/** Un trabajo que un agente está haciendo ahora en el servidor. */
export interface AgentJob {
  agentName: string;
  task: string;
  userName: string;
  target?: string;
  startedAt: string;
}

/** Varias partes de la página pueden preguntar a la vez: se comparte una sola consulta. */
let shared: { projectId: string; at: number; promise: Promise<AgentJob[]> } | null = null;

function fetchJobs(projectId: string): Promise<AgentJob[]> {
  if (shared && shared.projectId === projectId && Date.now() - shared.at < 1500) {
    return shared.promise;
  }
  const promise = client.agents.status(projectId).then(({ agents }) =>
    agents.flatMap((a) => a.working.map((w) => ({ ...w, agentName: a.name })))
  );
  shared = { projectId, at: Date.now(), promise };
  return promise;
}

/**
 * Retoma un trabajo de IA que siguió en el servidor mientras el usuario estaba en otra página.
 * Al montarse pregunta si hay un agente trabajando sobre `target` (por ejemplo "stage:database");
 * si lo hay, lo devuelve y sigue preguntando cada 2 s hasta que termina, y entonces llama a
 * `onDone` para recargar lo que el agente guardó.
 */
export function useAgentJob(
  projectId: string | undefined,
  target: string,
  onDone: () => void,
): AgentJob | null {
  const [job, setJob] = useState<AgentJob | null>(null);
  const done = useRef(onDone);
  done.current = onDone;

  useEffect(() => {
    if (!projectId) return;
    let alive = true;
    let seen = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        const found = (await fetchJobs(projectId)).find((j) => j.target === target) ?? null;
        if (!alive) return;
        setJob(found);
        if (found) {
          seen = true;
          timer = setTimeout(tick, 2000);
        } else if (seen) {
          seen = false;
          done.current();
        }
      } catch {
        if (alive && seen) timer = setTimeout(tick, 4000);
      }
    };
    tick();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [projectId, target]);

  return job;
}
