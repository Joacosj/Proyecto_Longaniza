import { useEffect, useState } from "react";
import { client } from "../api";
import { type AgentStatus, type Project, STAGE_LABEL } from "../types";
import { errorText, formatDate, Loading, Notice } from "../ui";

const ACTION_LABEL: Record<string, string> = {
  "stage.generated": "generó la etapa",
  "inconsistency.ai_resolved": "resolvió una inconsistencia",
  "agent.audited": "auditó el proyecto",
  "agent.reviewed": "revisó los documentos",
  "agent.designed": "dibujó una pantalla",
};

/**
 * Los agentes de IA del proyecto: qué hace cada uno, con qué skills y tools trabaja, si está
 * trabajando ahora y cuál fue su última intervención. Se actualiza solo cada pocos segundos.
 */
export function AgentsTab({ project }: { project: Project }) {
  const [agents, setAgents] = useState<AgentStatus[] | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const { agents } = await client.agents.status(project.id);
        if (alive) {
          setAgents(agents);
          setError(null);
        }
      } catch (err) {
        if (alive) setError(err);
      }
    };
    load();
    const timer = setInterval(load, 3000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [project.id]);

  if (error && !agents) return <Notice>{errorText(error)}</Notice>;
  if (!agents) return <Loading />;
  const busy = agents.filter((a) => a.working.length > 0);

  return (
    <section className="stack">
      <div>
        <p className="eyebrow">Equipo de IA</p>
        <h2>Agentes trabajando por detrás</h2>
        <p className="muted">
          Cada agente es una IA especializada con su rol, sus skills (conocimiento que se le da) y
          sus tools (validaciones en código que revisan su trabajo antes de aceptarlo). Ningún
          resultado de un agente se guarda sin pasar por sus tools.
        </p>
        <p className="agents-summary" role="status">
          {busy.length === 0
            ? "Todos los agentes están en espera."
            : `${busy.map((a) => a.name).join(", ")} ${busy.length === 1 ? "está" : "están"} trabajando ahora.`}
        </p>
      </div>
      <ul className="agents-grid">
        {agents.map((a, i) => {
          const working = a.working[0];
          return (
            <li key={a.id} className={`agent-card${working ? " is-working" : ""}`} style={{ "--i": i } as never}>
              <header className="agent-head">
                <span className="agent-dot" aria-hidden="true" />
                <h3>{a.name}</h3>
                {a.stage && <span className="chip">{STAGE_LABEL[a.stage]}</span>}
              </header>
              <p className="small">{a.role}</p>
              <div className="agent-kit">
                <p className="agent-kit-label">Skills</p>
                <span className="chips">{a.skills.map((s) => <span key={s} className="chip skill">{s}</span>)}</span>
                <p className="agent-kit-label">Tools</p>
                <span className="chips">{a.tools.map((t) => <span key={t} className="chip tool">{t}</span>)}</span>
              </div>
              <p className="agent-status small">
                {working
                  ? <span className="thinking">{working.task} · pedido por {working.userName}</span>
                  : a.lastAction
                  ? (
                    <span className="muted">
                      Última vez: {ACTION_LABEL[a.lastAction.action] ?? a.lastAction.action}
                      {a.lastAction.entityId && a.lastAction.action === "stage.generated"
                        ? ` ${STAGE_LABEL[a.lastAction.entityId as keyof typeof STAGE_LABEL] ?? ""}`
                        : ""} · {formatDate(a.lastAction.createdAt)}
                    </span>
                  )
                  : <span className="muted">Aún no interviene en este proyecto.</span>}
              </p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
