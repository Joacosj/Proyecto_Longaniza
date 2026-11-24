import { useState } from "react";
import { useAgentJob } from "../agentJobs";
import { client } from "../api";
import type { ScreenPreview as Preview } from "../types";
import { errorText, formatDate, Notice } from "../ui";

/**
 * Vista previa de alta fidelidad dibujada por el agente Diseñador visual. El HTML ya pasó el
 * validador de HTML seguro en el servidor y además se muestra en un iframe sin permisos
 * (`sandbox` vacío: sin scripts, sin formularios, sin navegación) y con una política de
 * contenido que solo permite estilos en línea.
 */
export function ScreenPreview(
  { projectId, screenId, screenName, initial, onSaved, onRefresh }: {
    projectId: string;
    screenId: string;
    screenName: string;
    initial?: Preview;
    onSaved: (p: Preview) => void;
    /** Recarga los diseños guardados (cuando el agente terminó mientras no se miraba). */
    onRefresh: () => void;
  },
) {
  const [localBusy, setBusy] = useState(false);
  const job = useAgentJob(projectId, `preview:${screenId}`, () => {
    onRefresh();
    setView("design");
  });
  const busy = localBusy || !!job;
  const [error, setError] = useState<unknown>(null);
  const [view, setView] = useState<"wire" | "design">(initial ? "design" : "wire");

  async function design() {
    setBusy(true);
    setError(null);
    try {
      const { preview } = await client.agents.preview(projectId, screenId);
      onSaved(preview);
      setView("design");
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="preview-bar">
      <div className="row">
        {initial && (
          <span className="seg" role="tablist" aria-label={`Vista de ${screenName}`}>
            <button type="button" role="tab" aria-selected={view === "wire"} onClick={() => setView("wire")}>
              Boceto
            </button>
            <button type="button" role="tab" aria-selected={view === "design"} onClick={() => setView("design")}>
              Diseño
            </button>
          </span>
        )}
        <button type="button" onClick={design} disabled={busy}>
          {busy ? "Dibujando…" : initial ? "⚙ Volver a diseñar" : "⚙ Diseñar con IA"}
        </button>
      </div>
      {busy && <p className="thinking">el Diseñador visual está dibujando {screenName}</p>}
      {error ? <Notice onClose={() => setError(null)}>{errorText(error)}</Notice> : null}
      {initial && view === "design" && (
        <figure className="preview-frame">
          <iframe
            title={`Diseño de ${screenName}`}
            sandbox=""
            srcDoc={withCsp(initial.html)}
            loading="lazy"
          />
          <figcaption className="muted small">
            Diseño generado por el Diseñador visual
            {initial.createdBy ? ` a pedido de ${initial.createdBy}` : ""} · {formatDate(initial.createdAt)}
          </figcaption>
        </figure>
      )}
    </div>
  );
}

const CSP = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">`;

function withCsp(html: string): string {
  return /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => m + CSP) : CSP + html;
}
