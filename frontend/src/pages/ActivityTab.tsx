import { client } from "../api";
import { AGENT_NAME, type AgentId, type Project, STAGE_LABEL, type StageKind } from "../types";
import { errorText, formatDate, Loading, Notice, useLoad } from "../ui";
import type { AuditEntry } from "../types";

/** Traduce una entrada de auditoría a una frase legible. */
function describe(e: AuditEntry): string {
  const d = e.detail as Record<string, unknown>;
  const stage = STAGE_LABEL[e.entityId as StageKind] ?? e.entityId;
  switch (e.action) {
    case "project.created": return "creó el proyecto";
    case "project.updated": return "editó los datos del proyecto";
    case "invitation.created": return `invitó a ${d.email} como ${d.role}`;
    case "member.added": return "se unió al proyecto";
    case "member.role_changed": return `cambió el rol de ${d.name} a ${d.to}`;
    case "member.removed": return `quitó a ${d.name} del proyecto`;
    case "stage.updated": return `editó ${stage} (versión ${d.version})`;
    case "stage.generated": return `generó ${stage} con la IA (versión ${d.version})`;
    case "stage.approved": return `aprobó ${stage}`;
    case "question.answered": return "respondió una pregunta";
    case "question.deferred": return "pospuso una pregunta";
    case "question.reopened": return "reabrió una pregunta";
    case "consistency.checked": return "revisó la consistencia entre etapas";
    case "inconsistency.resolved": return "marcó una inconsistencia como resuelta";
    case "inconsistency.ai_resolved":
      return `resolvió una inconsistencia con la IA en ${stage}${d.approved ? " y la aprobó" : ""}`;
    case "documents.generated": return `generó los documentos (versión ${d.version})`;
    case "agent.audited": return `pidió una auditoría semántica (${d.found} hallazgo(s))`;
    case "agent.reviewed": return `pidió una revisión externa de los documentos (${d.found} pregunta(s))`;
    case "agent.designed": return `generó la vista previa de ${e.entityId}`;
    default: return e.action;
  }
}

export function ActivityTab({ project }: { project: Project }) {
  const { data, error } = useLoad(() => client.projects.audit(project.id), [project.id]);
  if (error) return <Notice>{errorText(error)}</Notice>;
  if (!data) return <Loading />;
  return (
    <section>
      <h2>Actividad</h2>
      <ol className="activity">
        {data.entries.map((e) => (
          <li key={e.id}>
            <span className="muted">{formatDate(e.createdAt)}</span>{" "}
            <strong>{e.user?.name ?? "Alguien"}</strong> {describe(e)}
            {typeof e.detail?.agent === "string" && (
              <span className="agent-chip">⚙ {AGENT_NAME[e.detail.agent as AgentId] ?? e.detail.agent}</span>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
