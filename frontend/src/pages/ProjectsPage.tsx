import { type FormEvent, useState } from "react";
import { client } from "../api";
import { navigate, paths } from "../router";
import { STAGE_LABEL, STAGE_ORDER } from "../types";
import { errorText, formatDate, Loading, Notice, RoleTag, useLoad } from "../ui";

const STATUS_LABEL = {
  in_progress: "En curso",
  ready: "Listo para generar",
  generated: "Documentos generados",
};

export function ProjectsPage() {
  const { data, error, loading } = useLoad(() => client.projects.list(), []);
  const [creating, setCreating] = useState(false);

  return (
    <main className="page">
      <div className="page-head">
        <h1>Tus proyectos</h1>
        {!creating && (
          <button type="button" className="primary" onClick={() => setCreating(true)}>
            Nuevo proyecto
          </button>
        )}
      </div>

      {creating && <NewProject onCancel={() => setCreating(false)} />}
      {error ? <Notice>{errorText(error)}</Notice> : null}
      {loading && !data ? <Loading /> : null}

      {data && data.projects.length === 0 && !creating && (
        <div className="empty">
          <p>Aún no participas en ningún proyecto.</p>
          <p className="muted">
            Crea uno con tu idea inicial, o pide a alguien que te invite al suyo.
          </p>
        </div>
      )}

      {data && data.projects.length > 0 && (
        <ul className="project-list">
          {data.projects.map((p) => {
            const step = STAGE_ORDER.indexOf(p.currentStage) + 1;
            return (
              <li key={p.id}>
                <a href={paths.stage(p.id)} className="project-row">
                  <span className="project-name">{p.name}</span>
                  <span className="project-meta">
                    <RoleTag role={p.role} />
                    <span>
                      {p.status === "in_progress"
                        ? `Etapa ${step} de 6: ${STAGE_LABEL[p.currentStage]}`
                        : STATUS_LABEL[p.status]}
                    </span>
                    <span className="muted">Actualizado {formatDate(p.updatedAt)}</span>
                  </span>
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}

function NewProject({ onCancel }: { onCancel: () => void }) {
  const [name, setName] = useState("");
  const [idea, setIdea] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const { project } = await client.projects.create(name, idea);
      navigate(paths.stage(project.id));
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <form className="panel stack" onSubmit={submit}>
      <h2>Nuevo proyecto</h2>
      {error ? <Notice>{errorText(error)}</Notice> : null}
      <label>
        Nombre
        <input required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label>
        Idea inicial
        <textarea
          required
          rows={5}
          maxLength={10000}
          placeholder="Cuéntala como se la contarías a un colega: qué problema resuelve y para quién."
          value={idea}
          onChange={(e) => setIdea(e.target.value)}
        />
      </label>
      <div className="row">
        <button type="submit" className="primary" disabled={busy}>
          {busy ? "Creando…" : "Crear proyecto"}
        </button>
        <button type="button" onClick={onCancel}>Cancelar</button>
      </div>
    </form>
  );
}
