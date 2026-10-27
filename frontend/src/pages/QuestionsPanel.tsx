import { useState } from "react";
import { client } from "../api";
import type { Project, Question, StageKind } from "../types";
import { errorText, Loading, Notice, useLoad } from "../ui";

const ORDER = { open: 0, deferred: 1, answered: 2 } as const;

export function QuestionsPanel(
  { project, kind, onChange }: { project: Project; kind: StageKind; onChange: () => void },
) {
  const { data, error, setData } = useLoad(() => client.dialog.questions(project.id, kind), [
    project.id,
    kind,
  ]);
  const canAnswer = project.role !== "viewer";

  if (error) return <Notice>{errorText(error)}</Notice>;
  if (!data) return <Loading />;

  const sorted = [...data.questions].sort((a, b) =>
    ORDER[a.status] - ORDER[b.status] || Number(b.isBlocking) - Number(a.isBlocking)
  );
  const blockingOpen = sorted.filter((q) => q.isBlocking && q.status === "open").length;

  const replace = (q: Question) => {
    setData((prev) => ({ questions: (prev?.questions ?? []).map((x) => (x.id === q.id ? q : x)) }));
    onChange();
  };

  return (
    <div className="questions">
      {blockingOpen > 0 && (
        <p className="blocking-summary">
          {blockingOpen === 1
            ? "1 pregunta bloqueante impide aprobar esta etapa."
            : `${blockingOpen} preguntas bloqueantes impiden aprobar esta etapa.`}
        </p>
      )}
      {sorted.length === 0 && (
        <p className="muted">
          No hay preguntas en esta etapa. Aparecen cuando conversas con la IA o generas una
          propuesta.
        </p>
      )}
      <ul className="question-list">
        {sorted.map((q) => (
          <QuestionItem key={q.id} q={q} project={project} canAnswer={canAnswer} onUpdated={replace} />
        ))}
      </ul>
    </div>
  );
}

function QuestionItem(
  { q, project, canAnswer, onUpdated }: {
    q: Question;
    project: Project;
    canAnswer: boolean;
    onUpdated: (q: Question) => void;
  },
) {
  const [answer, setAnswer] = useState(q.answer ?? "");
  const [editing, setEditing] = useState(q.status !== "answered");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function act(fn: () => Promise<{ question: Question }>) {
    setBusy(true);
    setError(null);
    try {
      const { question } = await fn();
      onUpdated(question);
      setEditing(question.status !== "answered");
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  const cls = ["question", `is-${q.status}`, q.isBlocking ? "is-blocking" : ""].join(" ");

  return (
    <li className={cls}>
      <p className="q-text">
        {q.isBlocking && q.status === "open" && <span className="flag">Bloqueante</span>}
        {q.text}
      </p>
      <p className="muted q-why">{q.rationale}</p>

      {q.status === "answered" && !editing && (
        <div className="q-answer">
          <p>{q.answer}</p>
          <p className="muted">Respondida por {q.answeredBy?.name ?? "—"}</p>
          {canAnswer && <button type="button" className="link" onClick={() => setEditing(true)}>Cambiar respuesta</button>}
        </div>
      )}
      {q.status === "deferred" && <p className="muted">Pospuesta.</p>}

      {canAnswer && editing && (
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            act(() => client.dialog.answer(project.id, q.id, answer.trim()));
          }}
        >
          <label className="sr-only" htmlFor={`a-${q.id}`}>Respuesta</label>
          <textarea id={`a-${q.id}`} rows={2} value={answer} onChange={(e) => setAnswer(e.target.value)} />
          <div className="row">
            <button type="submit" className="primary" disabled={busy || !answer.trim()}>Responder</button>
            {!q.isBlocking && q.status === "open" && (
              <button type="button" disabled={busy} onClick={() => act(() => client.dialog.setQuestionStatus(project.id, q.id, "deferred"))}>
                Posponer
              </button>
            )}
            {q.status === "deferred" && (
              <button type="button" disabled={busy} onClick={() => act(() => client.dialog.setQuestionStatus(project.id, q.id, "open"))}>
                Reabrir
              </button>
            )}
          </div>
        </form>
      )}
      {error ? <Notice>{errorText(error)}</Notice> : null}
    </li>
  );
}
