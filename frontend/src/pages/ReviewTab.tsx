import { useState } from "react";
import { ApiError, client } from "../api";
import { paths } from "../router";
import { type DocumentInfo, type Pending, type Project, STAGE_LABEL } from "../types";
import { errorText, formatDate, Loading, Notice, useLoad } from "../ui";

const DOC_LABEL = { product_spec: "Especificación del producto", architecture: "Arquitectura" };

export function ReviewTab({ project, onProjectChange }: { project: Project; onProjectChange: () => void }) {
  const { data, error, reload } = useLoad(() => client.review.get(project.id), [project.id]);
  const [busy, setBusy] = useState<null | "check" | "docs">(null);
  const [notice, setNotice] = useState<{ kind: "ok" | "error" | "info"; text: string } | null>(null);
  const [blockedBy, setBlockedBy] = useState<Pending | null>(null);
  const canEdit = project.role !== "viewer";

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
                <li key={i.id} className={`inc is-${i.severity}`}>
                  <span className="flag">{i.severity === "critical" ? "Crítica" : "Advertencia"}</span>
                  <p>{i.description}</p>
                  <p className="muted">{i.stages.map((s) => STAGE_LABEL[s]).join(", ")}</p>
                  {canEdit && (
                    <button type="button" className="link" onClick={() => resolve(i.id)}>
                      Marcar como resuelta
                    </button>
                  )}
                </li>
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
