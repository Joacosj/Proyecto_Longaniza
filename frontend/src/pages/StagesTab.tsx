import { useEffect, useState } from "react";
import { ApiError, client, isVersionConflict } from "../api";
import { paths } from "../router";
import { JsonView } from "../stages/JsonView";
import { stageComponent } from "../stages/registry";
import {
  type Project,
  type Stage,
  STAGE_LABEL,
  STAGE_ORDER,
  type StageKind,
  type StageSummary,
} from "../types";
import { errorText, formatDate, Loading, Notice, useLoad } from "../ui";
import { ChatPanel } from "./ChatPanel";
import { QuestionsPanel } from "./QuestionsPanel";

const STATUS_LABEL = { locked: "Bloqueada", in_progress: "En curso", approved: "Aprobada" };

function isKind(v: string | undefined): v is StageKind {
  return !!v && (STAGE_ORDER as string[]).includes(v);
}

export function StagesTab(
  { project, selected, onProjectChange }: {
    project: Project;
    selected?: string;
    onProjectChange: () => void;
  },
) {
  const kind: StageKind = isKind(selected) ? selected : project.currentStage;
  const stages = useLoad(() => client.stages.list(project.id), [project.id]);
  /** Se incrementa para que los paneles laterales recarguen (ej. tras generar). */
  const [sideKey, setSideKey] = useState(0);
  /** Se incrementa cuando el contenido cambia desde afuera de la vista (borrador del chat). */
  const [stageKey, setStageKey] = useState(0);

  const refreshAll = () => {
    stages.reload();
    onProjectChange();
    setSideKey((k) => k + 1);
  };

  return (
    <div className="stages">
      {stages.data && <StageRail projectId={project.id} stages={stages.data.stages} active={kind} />}
      {stages.error ? <Notice>{errorText(stages.error)}</Notice> : null}

      {kind === "review"
        ? (
          <section className="panel">
            <h2>Revisión</h2>
            <p>
              La última etapa reúne todo: pendientes, inconsistencias entre etapas y la generación
              de los dos documentos.
            </p>
            <a className="button primary" href={paths.review(project.id)}>Ir a la revisión final</a>
          </section>
        )
        : (
          <div className="stage-layout">
            <StageView key={`stage-${kind}-${stageKey}`} project={project} kind={kind} onSaved={refreshAll} />
            <SidePanels
              key={`side-${kind}-${sideKey}`}
              project={project}
              kind={kind}
              onChange={() => {
                stages.reload();
                onProjectChange();
              }}
              onStageReplaced={() => {
                setStageKey((k) => k + 1);
                refreshAll();
              }}
            />
          </div>
        )}
    </div>
  );
}

function StageRail(
  { projectId, stages, active }: { projectId: string; stages: StageSummary[]; active: StageKind },
) {
  return (
    <ol className="rail" aria-label="Etapas del proyecto">
      {stages.map((s, i) => (
        <li key={s.kind} className={`rail-step is-${s.status}${s.kind === active ? " is-active" : ""}`}>
          <a href={paths.stage(projectId, s.kind)} aria-current={s.kind === active ? "step" : undefined}>
            <span className="rail-num">{i + 1}</span>
            <span className="rail-label">{STAGE_LABEL[s.kind]}</span>
            <span className="rail-status">{STATUS_LABEL[s.status]}</span>
          </a>
        </li>
      ))}
    </ol>
  );
}

function StageView(
  { project, kind, onSaved }: { project: Project; kind: StageKind; onSaved: () => void },
) {
  const loaded = useLoad(() => client.stages.get(project.id, kind), [project.id, kind]);
  const [draft, setDraft] = useState<Record<string, unknown> | null>(null);
  const [busy, setBusy] = useState<null | "save" | "approve" | "generate">(null);
  const [notice, setNotice] = useState<{ kind: "error" | "ok" | "warn"; text: React.ReactNode } | null>(
    null,
  );
  const [lostDraft, setLostDraft] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  /** Ver o editar el artefacto como JSON aunque la etapa tenga su componente propio. */
  const [rawJson, setRawJson] = useState(false);

  const stage = loaded.data?.stage;
  useEffect(() => {
    setDraft(null);
  }, [stage?.version]);

  if (loaded.error) return <Notice>{errorText(loaded.error)}</Notice>;
  if (!stage) return <Loading />;

  const canEdit = project.role !== "viewer" && stage.status !== "locked";
  const dirty = draft !== null;
  const artifact = draft ?? stage.artifact;
  const isEmpty = Object.keys(stage.artifact).length === 0;

  function apply(next: Stage) {
    loaded.setData({ stage: next });
    setDraft(null);
    onSaved();
  }

  /** Maneja un 409 de versión: avisa, guarda el borrador perdido y recarga. */
  async function onConflict(err: ApiError & { details: { currentVersion: number; updatedBy: string | null } }) {
    if (dirty) setLostDraft(JSON.stringify(draft, null, 2));
    setNotice({
      kind: "warn",
      text: (
        <>
          <strong>{err.details.updatedBy ?? "Otra persona"} modificó esta etapa</strong>{" "}
          mientras la tenías abierta (ahora va en la versión {err.details.currentVersion}).
          Cargamos la versión actual.{dirty ? " Tus cambios sin guardar quedaron abajo para que los copies." : ""}
        </>
      ),
    });
    await loaded.reload();
    onSaved();
  }

  async function run(action: "save" | "approve" | "generate") {
    if (!stage) return;
    if (action === "generate" && (dirty || !isEmpty)) {
      const ok = confirm(
        dirty
          ? "Tienes cambios sin guardar. La propuesta de la IA los reemplazará. ¿Continuar?"
          : "La propuesta de la IA reemplazará el contenido actual (queda en el historial). ¿Continuar?",
      );
      if (!ok) return;
    }
    setBusy(action);
    setNotice(null);
    try {
      if (action === "save") {
        apply((await client.stages.save(project.id, kind, stage.version, draft)).stage);
        setNotice({ kind: "ok", text: "Cambios guardados." });
      } else if (action === "approve") {
        apply((await client.stages.approve(project.id, kind, stage.version)).stage);
        setNotice({ kind: "ok", text: "Etapa aprobada. La siguiente quedó disponible." });
      } else {
        const out = await client.stages.generate(project.id, kind, stage.version);
        apply(out.stage);
        setNotice({
          kind: "ok",
          text: out.questions.length
            ? `Propuesta generada. La IA dejó ${out.questions.length} pregunta(s) nueva(s).`
            : "Propuesta generada. Revísala y edítala antes de aprobar.",
        });
      }
    } catch (err) {
      if (isVersionConflict(err)) return onConflict(err);
      const blocking = (err instanceof ApiError
        ? (err.details as { blockingQuestions?: { id: string; text: string }[] } | undefined)
          ?.blockingQuestions
        : undefined) ?? [];
      // Las preguntas nuevas ya quedaron guardadas: recarga el panel para que se vean.
      if (blocking.length > 0) onSaved();
      setNotice({
        kind: "error",
        text: (
          <>
            {errorText(err)}
            {blocking.length > 0 && (
              <ul>{blocking.map((q) => <li key={q.id}>{q.text}</li>)}</ul>
            )}
          </>
        ),
      });
    } finally {
      setBusy(null);
    }
  }

  const Custom = rawJson ? undefined : stageComponent(kind);
  const hasCustom = !!stageComponent(kind);

  return (
    <section className="stage-main" aria-labelledby="stage-title">
      <header className="stage-head">
        <div>
          <h2 id="stage-title">{STAGE_LABEL[kind]}</h2>
          <p className="muted">
            {STATUS_LABEL[stage.status]} · versión {stage.version}
            {stage.updatedBy ? ` · editada por ${stage.updatedBy.name} el ${formatDate(stage.updatedAt)}` : ""}
            {stage.approvedBy ? ` · aprobada por ${stage.approvedBy.name}` : ""}
          </p>
        </div>
        {canEdit && (
          <div className="row actions">
            <button type="button" onClick={() => run("generate")} disabled={!!busy}>
              {busy === "generate" ? "Generando…" : "Generar con IA"}
            </button>
            <button type="button" onClick={() => run("save")} disabled={!dirty || !!busy}>
              {busy === "save" ? "Guardando…" : "Guardar cambios"}
            </button>
            {stage.status !== "approved" && (
              <button
                type="button"
                className="primary"
                onClick={() => run("approve")}
                disabled={dirty || isEmpty || !!busy}
                title={dirty ? "Guarda los cambios antes de aprobar" : isEmpty ? "La etapa está vacía" : undefined}
              >
                {busy === "approve" ? "Aprobando…" : "Aprobar etapa"}
              </button>
            )}
          </div>
        )}
      </header>

      {notice && <Notice kind={notice.kind} onClose={() => setNotice(null)}>{notice.text}</Notice>}
      {stage.status === "locked" && (
        <Notice kind="info">Esta etapa se desbloquea cuando se aprueba la anterior.</Notice>
      )}
      {stage.status === "approved" && canEdit && (
        <p className="muted">
          Editar una etapa aprobada le quita la aprobación a ella y a las etapas siguientes.
        </p>
      )}
      {dirty && <p className="dirty">Tienes cambios sin guardar.</p>}

      {isEmpty && !dirty
        ? (
          <div className="empty">
            <p>Esta etapa aún no tiene contenido.</p>
            <p className="muted">
              {canEdit
                ? "Usa “Generar con IA” para partir de una propuesta basada en las etapas anteriores, o conversa con la IA en el panel."
                : "Cuando alguien del equipo la complete, la verás aquí."}
            </p>
          </div>
        )
        : Custom
        ? <Custom artifact={artifact as never} editable={canEdit} onChange={setDraft as never} projectId={project.id} />
        : <JsonView artifact={artifact} editable={canEdit} onChange={setDraft} />}

      {lostDraft && (
        <details className="lost" open>
          <summary>Tus cambios que no se guardaron</summary>
          <pre className="json">{lostDraft}</pre>
          <div className="row">
            <button type="button" onClick={() => navigator.clipboard?.writeText(lostDraft)}>Copiar</button>
            <button type="button" onClick={() => setLostDraft(null)}>Descartar</button>
          </div>
        </details>
      )}

      <div className="history-toggle row">
        {hasCustom && !(isEmpty && !dirty) && (
          <button type="button" className="link" onClick={() => setRawJson((v) => !v)} aria-pressed={rawJson}>
            {rawJson ? "Volver a la vista normal" : canEdit ? "Editar como JSON" : "Ver como JSON"}
          </button>
        )}
        <button type="button" className="link" onClick={() => setShowHistory((v) => !v)} aria-expanded={showHistory}>
          {showHistory ? "Ocultar historial" : "Ver historial de versiones"}
        </button>
      </div>
      {showHistory && <History projectId={project.id} kind={kind} version={stage.version} />}
    </section>
  );
}

function History({ projectId, kind, version }: { projectId: string; kind: StageKind; version: number }) {
  const { data, error } = useLoad(() => client.stages.versions(projectId, kind), [projectId, kind, version]);
  const [open, setOpen] = useState<number | null>(null);
  if (error) return <Notice>{errorText(error)}</Notice>;
  if (!data) return <Loading />;
  if (data.versions.length === 0) return <p className="muted">Todavía no hay guardados.</p>;
  return (
    <ul className="history">
      {data.versions.map((v) => (
        <li key={v.version}>
          <button type="button" className="link" onClick={() => setOpen(open === v.version ? null : v.version)}>
            Versión {v.version}
          </button>{" "}
          <span className="muted">
            {v.source === "ai" ? "propuesta de la IA" : "edición manual"} · {v.createdBy?.name ?? "—"} ·{" "}
            {formatDate(v.createdAt)}
          </span>
          {open === v.version && <pre className="json">{JSON.stringify(v.artifact, null, 2)}</pre>}
        </li>
      ))}
    </ul>
  );
}

function SidePanels(
  { project, kind, onChange, onStageReplaced }: {
    project: Project;
    kind: StageKind;
    onChange: () => void;
    onStageReplaced: () => void;
  },
) {
  const [tab, setTab] = useState<"chat" | "questions">("questions");
  const [questionsKey, setQuestionsKey] = useState(0);
  return (
    <aside className="side" aria-label="Conversación y preguntas">
      <div className="side-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === "questions"} onClick={() => setTab("questions")}>
          Preguntas
        </button>
        <button type="button" role="tab" aria-selected={tab === "chat"} onClick={() => setTab("chat")}>
          Conversación
        </button>
      </div>
      {tab === "questions"
        ? <QuestionsPanel key={questionsKey} project={project} kind={kind} onChange={onChange} />
        : (
          <ChatPanel
            project={project}
            kind={kind}
            onNewQuestions={() => setQuestionsKey((k) => k + 1)}
            onDraftApplied={onStageReplaced}
          />
        )}
    </aside>
  );
}
