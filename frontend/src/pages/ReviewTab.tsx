import { useState } from "react";
import { useAgentJob } from "../agentJobs";
import { ApiError, client } from "../api";
import { paths } from "../router";
import {
  type DocumentInfo,
  type Inconsistency,
  type Pending,
  type Project,
  type Resolution,
  STAGE_LABEL,
} from "../types";
import { errorText, formatDate, Loading, Notice, useLoad } from "../ui";

const DOC_LABEL = { product_spec: "Especificación del producto", architecture: "Arquitectura" };

export function ReviewTab({ project, onProjectChange }: { project: Project; onProjectChange: () => void }) {
  const { data, error, reload } = useLoad(() => client.review.get(project.id), [project.id]);
  const [busy, setBusy] = useState<null | "check" | "docs" | "audit" | "external">(null);
  const [notice, setNotice] = useState<{ kind: "ok" | "error" | "info"; text: string } | null>(null);
  const [blockedBy, setBlockedBy] = useState<Pending | null>(null);
  const canEdit = project.role !== "viewer";
  // Si el auditor o el revisor siguieron trabajando mientras el usuario estaba en otra página.
  const auditJob = useAgentJob(project.id, "audit", () => {
    reload();
    setNotice({ kind: "info", text: "El Auditor semántico terminó: revisa la lista de inconsistencias." });
  });
  const reviewJob = useAgentJob(project.id, "external-review", () => {
    reload();
    onProjectChange();
    setNotice({ kind: "info", text: "El Revisor externo terminó: sus preguntas están en el panel Preguntas de cada etapa." });
  });
  const auditing = busy === "audit" || !!auditJob;
  const reviewing = busy === "external" || !!reviewJob;

  if (error) return <Notice>{errorText(error)}</Notice>;
  if (!data) return <Loading />;

  const pending = blockedBy ?? data.pending;
  const nothingPending = pending.unapprovedStages.length + pending.blockingQuestions.length +
      pending.criticalInconsistencies.length === 0;

  async function check() {
    setBusy("check");
    setNotice(null);
    try {
      const out = await client.review.check(project.id);
      setNotice({
        kind: "info",
        text: out.inconsistencies.length === 0
          ? "El validador no encontró inconsistencias entre etapas."
          : `El validador encontró ${out.inconsistencies.length} inconsistencia(s) abiertas.`,
      });
      setBlockedBy(null);
      await reload();
    } catch (err) {
      setNotice({ kind: "error", text: errorText(err) });
    } finally {
      setBusy(null);
    }
  }

  async function runAgent(kind: "audit" | "external") {
    setBusy(kind);
    setNotice(null);
    try {
      if (kind === "audit") {
        const out = await client.agents.semanticAudit(project.id);
        setNotice({
          kind: "info",
          text: out.found === 0
            ? "El Auditor semántico no encontró problemas de significado entre etapas."
            : `El Auditor semántico encontró ${out.found} problema(s); ${out.added} nuevo(s) en la lista de inconsistencias.`,
        });
      } else {
        const out = await client.agents.externalReview(project.id);
        setNotice({
          kind: "info",
          text: out.questions.length === 0
            ? "El Revisor externo no tendría que inventar nada para implementar el producto."
            : `El Revisor externo dejó ${out.questions.length} pregunta(s) en las etapas correspondientes (panel Preguntas).`,
        });
      }
      await reload();
    } catch (err) {
      setNotice({ kind: "error", text: errorText(err) });
    } finally {
      setBusy(null);
    }
  }

  async function generate() {
    setBusy("docs");
    setNotice(null);
    try {
      const out = await client.review.generateDocuments(project.id);
      setNotice({ kind: "ok", text: `Documentos generados (versión ${out.version}).` });
      setBlockedBy(null);
      await reload();
      onProjectChange();
    } catch (err) {
      const p = err instanceof ApiError ? (err.details as { pending?: Pending } | undefined)?.pending : undefined;
      if (p) setBlockedBy(p);
      setNotice({ kind: "error", text: errorText(err) });
      await reload();
    } finally {
      setBusy(null);
    }
  }

  async function resolve(id: string) {
    try {
      await client.review.resolve(project.id, id);
      setBlockedBy(null);
      await reload();
    } catch (err) {
      setNotice({ kind: "error", text: errorText(err) });
    }
  }

  const versions = groupByVersion(data.documents);

  return (
    <div className="review">
      {notice && <Notice kind={notice.kind} onClose={() => setNotice(null)}>{notice.text}</Notice>}

      {canEdit && (
        <section className="agent-actions">
          <div>
            <p className="eyebrow">Agentes de revisión</p>
            <p className="muted small">
              El Auditor revisa reglas, permisos y casos borde que el validador en código no ve. El
              Revisor externo lee los documentos como la IA que implementará el producto y deja
              preguntas por lo que tendría que inventar.
            </p>
          </div>
          <div className="row">
            <button type="button" onClick={() => runAgent("audit")} disabled={!!busy || auditing}>
              {auditing ? "Auditando…" : "⚙ Auditor semántico"}
            </button>
            <button type="button" onClick={() => runAgent("external")} disabled={!!busy || reviewing}>
              {reviewing ? "Leyendo documentos…" : "⚙ Revisor externo"}
            </button>
          </div>
          {auditing && <p className="thinking">el Auditor semántico está revisando el proyecto</p>}
          {reviewing && <p className="thinking">el Revisor externo está leyendo los documentos</p>}
        </section>
      )}

      <section className="stack">
        <div className="page-head">
          <h2>Antes de generar</h2>
          {canEdit && (
            <div className="row">
              <button type="button" onClick={check} disabled={!!busy}>
                {busy === "check" ? "Revisando…" : "Revisar consistencia"}
              </button>
              <button type="button" className="primary" onClick={generate} disabled={!!busy || !nothingPending}>
                {busy === "docs" ? "Generando…" : "Generar documentos"}
              </button>
            </div>
          )}
        </div>

        {nothingPending
          ? <Notice kind="ok">Todo listo: las etapas están aprobadas y no hay bloqueos.</Notice>
          : (
            <ul className="pending">
              {pending.unapprovedStages.length > 0 && (
                <li>
                  <strong>Etapas sin aprobar:</strong>{" "}
                  {pending.unapprovedStages.map((k, i) => (
                    <span key={k}>
                      {i > 0 && ", "}
                      <a href={paths.stage(project.id, k)}>{STAGE_LABEL[k]}</a>
                    </span>
                  ))}
                </li>
              )}
              {pending.blockingQuestions.length > 0 && (
                <li>
                  <strong>Preguntas bloqueantes sin responder:</strong>
                  <ul>
                    {pending.blockingQuestions.map((q) => (
                      <li key={q.id}>
                        <a href={paths.stage(project.id, q.stageKind)}>{STAGE_LABEL[q.stageKind]}</a>: {q.text}
                      </li>
                    ))}
                  </ul>
                </li>
              )}
              {pending.criticalInconsistencies.length > 0 && (
                <li><strong>Inconsistencias críticas sin resolver:</strong> {pending.criticalInconsistencies.length}</li>
              )}
            </ul>
          )}
      </section>

      <section>
        <h2>Inconsistencias entre etapas</h2>
        {data.inconsistencies.length === 0
          ? <p className="muted">No hay inconsistencias abiertas. Usa “Revisar consistencia” después de cambiar etapas.</p>
          : (
            <ul className="inconsistencies">
              {data.inconsistencies.map((i) => (
                <InconsistencyItem
                  key={i.id}
                  project={project}
                  inc={i}
                  canEdit={canEdit}
                  onMarkResolved={() => resolve(i.id)}
                  onApplied={async (text) => {
                    setNotice({ kind: "ok", text });
                    setBlockedBy(null);
                    await reload();
                    onProjectChange();
                  }}
                />
              ))}
            </ul>
          )}
      </section>

      <section>
        <h2>Documentos</h2>
        {versions.length === 0
          ? <p className="muted">Aún no se generan. Cuando no haya pendientes, usa “Generar documentos”.</p>
          : (
            <ul className="documents">
              {versions.map(({ version, docs }, idx) => (
                <li key={version}>
                  <p>
                    <strong>Versión {version}</strong>{idx === 0 && " (la más reciente)"}{" "}
                    <span className="muted">
                      {docs[0].generatedBy.name} · {formatDate(docs[0].createdAt)}
                    </span>
                  </p>
                  <div className="row">
                    {docs.map((d) => (
                      <a key={d.kind} className="button" href={client.review.documentUrl(project.id, d.kind, d.version)} download>
                        Descargar {DOC_LABEL[d.kind]} (.md)
                      </a>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          )}
      </section>
    </div>
  );
}

function groupByVersion(docs: DocumentInfo[]) {
  const map = new Map<number, DocumentInfo[]>();
  for (const d of docs) map.set(d.version, [...(map.get(d.version) ?? []), d]);
  return [...map.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([version, list]) => ({ version, docs: list.sort((a, b) => a.kind.localeCompare(b.kind)).reverse() }));
}

/**
 * Una inconsistencia con dos salidas: marcarla como resuelta, o pedirle a la IA un cambio
 * mínimo en la etapa más tardía involucrada, revisarlo y aplicarlo.
 */
function InconsistencyItem(
  { project, inc, canEdit, onMarkResolved, onApplied }: {
    project: Project;
    inc: Inconsistency;
    canEdit: boolean;
    onMarkResolved: () => void;
    onApplied: (message: string) => Promise<void>;
  },
) {
  const [busy, setBusy] = useState<null | "propose" | "apply">(null);
  const [proposal, setProposal] = useState<Resolution | null>(null);
  const [error, setError] = useState<unknown>(null);

  async function propose() {
    setBusy("propose");
    setError(null);
    setProposal(null);
    try {
      setProposal((await client.review.aiResolve(project.id, inc.id)).resolution);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  }

  async function apply() {
    if (proposal?.kind !== "fix") return;
    setBusy("apply");
    setError(null);
    try {
      await client.review.applyResolution(project.id, inc.id, {
        stage: proposal.stage,
        version: proposal.baseVersion,
        artifact: proposal.artifact,
        summary: proposal.summary,
      });
      await onApplied(
        `Inconsistencia resuelta en ${STAGE_LABEL[proposal.stage]}` +
          (proposal.wasApproved ? ". La etapa queda aprobada por ti." : "."),
      );
    } catch (err) {
      setError(err);
      setBusy(null);
    }
  }

  return (
    <li className={`inc is-${inc.severity}`}>
      <span className="flag">{inc.severity === "critical" ? "Crítica" : "Advertencia"}</span>
      {inc.source === "auditor" && <span className="agent-chip">⚙ Auditor semántico</span>}
      <p>{inc.description}</p>
      <p className="muted">{inc.stages.map((s) => STAGE_LABEL[s]).join(", ")}</p>

      {canEdit && !proposal && (
        <div className="row">
          <button type="button" className="primary" onClick={propose} disabled={!!busy}>
            {busy === "propose" ? "Buscando solución…" : "⚙ Resolver con IA"}
          </button>
          <button type="button" className="link" onClick={onMarkResolved} disabled={!!busy}>
            Marcar como resuelta
          </button>
        </div>
      )}
      {busy === "propose" && (
        <p className="thinking" role="status">el Resolvedor está buscando el cambio mínimo que lo resuelve</p>
      )}
      {error ? <Notice onClose={() => setError(null)}>{errorText(error)}</Notice> : null}

      {proposal?.kind === "fix" && (
        <div className="resolution">
          <p className="eyebrow">Propuesta para {STAGE_LABEL[proposal.stage]}</p>
          <p>{proposal.summary}</p>
          {proposal.changes.length > 0 && (
            <ul className="resolution-changes">
              {proposal.changes.map((c) => <li key={c}>{c}</li>)}
            </ul>
          )}
          <p className="muted small">
            El validador confirmó que esto cierra la inconsistencia sin crear otras. Al aplicar se
            guarda una versión nueva de {STAGE_LABEL[proposal.stage]}
            {proposal.wasApproved ? ", que queda aprobada por ti" : ""}, y las etapas siguientes
            conservan su aprobación.
          </p>
          <div className="row">
            <button type="button" className="primary" onClick={apply} disabled={!!busy}>
              {busy === "apply" ? "Aplicando…" : "Aplicar"}
            </button>
            <button type="button" onClick={() => setProposal(null)} disabled={!!busy}>Descartar</button>
          </div>
        </div>
      )}
      {proposal?.kind === "manual" && (
        <div className="resolution is-manual">
          <p className="eyebrow">Hay que decidirlo en otra etapa</p>
          <p>{proposal.explanation}</p>
          <div className="row">
            {proposal.stage && proposal.stage !== "review" && (
              <a className="button" href={paths.stage(project.id, proposal.stage)}>
                Ir a {STAGE_LABEL[proposal.stage]}
              </a>
            )}
            <button type="button" className="link" onClick={() => setProposal(null)}>Cerrar</button>
          </div>
        </div>
      )}
    </li>
  );
}
