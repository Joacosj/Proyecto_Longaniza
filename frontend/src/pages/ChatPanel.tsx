import { type FormEvent, useEffect, useRef, useState } from "react";
import { client, isVersionConflict } from "../api";
import type { Message, Project, StageKind } from "../types";
import { errorText, Loading, Notice, useLoad } from "../ui";

export function ChatPanel(
  { project, kind, onNewQuestions, onDraftApplied }: {
    project: Project;
    kind: StageKind;
    onNewQuestions: () => void;
    onDraftApplied: () => void;
  },
) {
  const { data, error, setData } = useLoad(() => client.dialog.messages(project.id, kind), [
    project.id,
    kind,
  ]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [sendError, setSendError] = useState<unknown>(null);
  const [draft, setDraft] = useState<Record<string, unknown> | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const canWrite = project.role !== "viewer";

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [data?.messages.length]);

  async function send(e: FormEvent) {
    e.preventDefault();
    const content = text.trim();
    if (!content) return;
    setBusy(true);
    setSendError(null);
    try {
      const out = await client.dialog.send(project.id, kind, content);
      setData((prev) => ({ messages: [...(prev?.messages ?? []), out.message, out.reply] }));
      setText("");
      if (out.questions.length) {
        setInfo(`La IA dejó ${out.questions.length} pregunta(s) nueva(s) en Preguntas.`);
        onNewQuestions();
      }
      if (out.artifactDraft && typeof out.artifactDraft === "object") {
        setDraft(out.artifactDraft as Record<string, unknown>);
      }
    } catch (err) {
      setSendError(err);
    } finally {
      setBusy(false);
    }
  }

  /** Guarda el borrador de la IA como contenido de la etapa (queda en el historial). */
  async function applyDraft() {
    if (!draft) return;
    setBusy(true);
    try {
      const { stage } = await client.stages.get(project.id, kind);
      await client.stages.save(project.id, kind, stage.version, draft);
      setDraft(null);
      setInfo("Borrador guardado en la etapa. Revísalo antes de aprobar.");
      onDraftApplied();
    } catch (err) {
      setSendError(
        isVersionConflict(err) ? new Error("Otra persona guardó la etapa recién; intenta de nuevo.") : err,
      );
    } finally {
      setBusy(false);
    }
  }

  if (error) return <Notice>{errorText(error)}</Notice>;
  if (!data) return <Loading />;

  return (
    <div className="chat">
      <ol className="messages" aria-live="polite">
        {data.messages.length === 0 && (
          <li className="muted">
            Cuéntale a la IA lo que sabes de esta etapa. Te hará preguntas para completar lo que
            falte.
          </li>
        )}
        {data.messages.map((m: Message) => (
          <li key={m.id} className={`msg msg-${m.role}`}>
            <span className="msg-author">{m.role === "assistant" ? "Ideator" : m.user?.name ?? "Tú"}</span>
            <p>{m.content}</p>
          </li>
        ))}
        <div ref={endRef} />
      </ol>

      {info && <Notice kind="info" onClose={() => setInfo(null)}>{info}</Notice>}
      {sendError ? <Notice onClose={() => setSendError(null)}>{errorText(sendError)}</Notice> : null}

      {draft && canWrite && (
        <div className="draft-offer">
          <p>La IA propuso un borrador completo para esta etapa.</p>
          <button type="button" className="primary" onClick={applyDraft} disabled={busy}>
            Usar el borrador
          </button>{" "}
          <button type="button" className="link" onClick={() => setDraft(null)}>Descartar</button>
        </div>
      )}

      {canWrite
        ? (
          <form onSubmit={send} className="chat-form">
            <label className="sr-only" htmlFor="chat-input">Mensaje para la IA</label>
            <textarea
              id="chat-input"
              rows={3}
              value={text}
              placeholder="Escribe tu mensaje…"
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  (e.currentTarget.form as HTMLFormElement).requestSubmit();
                }
              }}
            />
            <button type="submit" className="primary" disabled={busy || !text.trim()}>
              {busy ? "Esperando a la IA…" : "Enviar"}
            </button>
          </form>
        )
        : <p className="muted">Como lector puedes ver la conversación, pero no escribir.</p>}
    </div>
  );
}
