import { type FormEvent, useState } from "react";
import { client } from "../api";
import { navigate, paths } from "../router";
import { STAGE_LABEL, STAGE_ORDER } from "../types";
import type { Project } from "../types";
import { ConfirmDialog, errorText, formatDate, Loading, Notice, RoleTag, useLoad } from "../ui";

const STATUS_LABEL = {
  in_progress: "En curso",
  ready: "Listo para generar",
  generated: "Documentos generados",
};

export function ProjectsPage() {
  const { data, error, loading, reload } = useLoad(() => client.projects.list(), []);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<Project | null>(null);

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">Laboratorio de ideas</p>
          <h1>Tus proyectos</h1>
        </div>
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
        <ul className="project-grid">
          {data.projects.map((p) => {
            const step = STAGE_ORDER.indexOf(p.currentStage) + 1;
            const finished = p.status !== "in_progress";
            return (
              <li key={p.id} className="project-card">
                <a href={paths.stage(p.id)} className="project-link">
                  <span className="project-name">{p.name}</span>
                  <span className="small">
                    {finished
                      ? STATUS_LABEL[p.status]
                      : `Etapa ${step} de 6 · ${STAGE_LABEL[p.currentStage]}`}
                  </span>
                  <span className="muted small">Actualizado {formatDate(p.updatedAt)}</span>
                </a>
                <span className="progress" aria-hidden="true">
                  {STAGE_ORDER.map((k, i) => (
                    <span
                      key={k}
                      className={finished || i < step - 1 ? "done" : i === step - 1 ? "current" : ""}
                    />
                  ))}
                </span>
                <span className="card-actions">
                  <RoleTag role={p.role} />
                  {p.role === "owner" && (
                    <button
                      type="button"
                      className="link danger"
                      aria-label={`Eliminar el proyecto ${p.name}`}
                      onClick={() => setDeleting(p)}
                    >
                      Eliminar
                    </button>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {deleting && (
        <ConfirmDialog
          title="Eliminar proyecto"
          confirmText={deleting.name}
          actionLabel="Eliminar definitivamente"
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            await client.projects.remove(deleting.id);
            setDeleting(null);
            await reload();
          }}
        >
          <p>
            Se borran sus etapas, conversaciones, preguntas y documentos para todos los miembros.
            No se puede deshacer.
          </p>
        </ConfirmDialog>
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
