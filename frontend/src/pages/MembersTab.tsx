import { type FormEvent, useState } from "react";
import { client } from "../api";
import { useAuth } from "../auth";
import { navigate, paths } from "../router";
import { type Project, type ProjectRole, ROLE_LABEL } from "../types";
import { ConfirmDialog, errorText, formatDate, Loading, Notice, RoleTag, useLoad } from "../ui";

export function MembersTab({ project, onProjectChange }: { project: Project; onProjectChange: () => void }) {
  const { user } = useAuth();
  const isOwner = project.role === "owner";
  const members = useLoad(() => client.members.list(project.id), [project.id]);
  const invitations = useLoad(
    () => (isOwner ? client.members.invitations(project.id) : Promise.resolve({ invitations: [] })),
    [project.id, isOwner],
  );
  const [error, setError] = useState<unknown>(null);

  async function act(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
      await members.reload();
      onProjectChange();
    } catch (err) {
      setError(err);
    }
  }

  return (
    <div className="two-col">
      <section>
        <h2>Miembros</h2>
        {error ? <Notice onClose={() => setError(null)}>{errorText(error)}</Notice> : null}
        {members.error ? <Notice>{errorText(members.error)}</Notice> : null}
        {!members.data ? <Loading /> : (
          <table className="table">
            <thead>
              <tr><th>Nombre</th><th>Correo</th><th>Rol</th>{isOwner && <th><span className="sr-only">Acciones</span></th>}</tr>
            </thead>
            <tbody>
              {members.data.members.map((m) => (
                <tr key={m.userId}>
                  <td>{m.name}{m.userId === user?.id ? <span className="muted"> (tú)</span> : null}</td>
                  <td>{m.email}</td>
                  <td>
                    {isOwner
                      ? (
                        <select
                          aria-label={`Rol de ${m.name}`}
                          value={m.role}
                          onChange={(e) => act(() => client.members.setRole(project.id, m.userId, e.target.value as ProjectRole))}
                        >
                          {(["owner", "editor", "viewer"] as const).map((r) => (
                            <option key={r} value={r}>{ROLE_LABEL[r]}</option>
                          ))}
                        </select>
                      )
                      : <RoleTag role={m.role} />}
                  </td>
                  {isOwner && (
                    <td>
                      {m.userId !== user?.id && (
                      <button
                        type="button"
                        className="link danger"
                        onClick={() => {
                          if (confirm(`¿Quitar a ${m.name} del proyecto?`)) {
                            act(() => client.members.remove(project.id, m.userId));
                          }
                        }}
                      >
                        Quitar
                      </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="muted small">
          Owner: administra miembros y el proyecto. Editor: edita, responde y aprueba etapas.
          Lector: solo ve.
        </p>
      </section>

      {isOwner && (
        <section className="stack">
          <Invite projectId={project.id} onInvited={invitations.reload} />
          {invitations.data && invitations.data.invitations.length > 0 && (
            <div>
              <h3>Invitaciones pendientes</h3>
              <ul className="plain">
                {invitations.data.invitations.map((i) => (
                  <li key={i.id}>
                    {i.email} · {ROLE_LABEL[i.role]}{" "}
                    <span className="muted">vence {formatDate(i.expiresAt)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <ProjectSettings project={project} onSaved={onProjectChange} />
        </section>
      )}
    </div>
  );
}

function Invite({ projectId, onInvited }: { projectId: string; onInvited: () => void }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"editor" | "viewer">("editor");
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [copied, setCopied] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const { token } = await client.members.invite(projectId, email, role);
      setLink(`${location.origin}${location.pathname}${paths.invitation(token)}`);
      setCopied(false);
      setEmail("");
      onInvited();
    } catch (err) {
      setError(err);
    }
  }

  return (
    <form className="panel stack" onSubmit={submit}>
      <h3>Invitar a alguien</h3>
      {error ? <Notice>{errorText(error)}</Notice> : null}
      <label>
        Correo
        <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      <label>
        Rol
        <select value={role} onChange={(e) => setRole(e.target.value as "editor" | "viewer")}>
          <option value="editor">Editor</option>
          <option value="viewer">Lector</option>
        </select>
      </label>
      <button type="submit" className="primary">Crear invitación</button>
      {link && (
        <div className="invite-link">
          <p>Comparte este enlace. Solo sirve para ese correo y vence en 7 días.</p>
          <input readOnly value={link} onFocus={(e) => e.currentTarget.select()} aria-label="Enlace de invitación" />
          <button
            type="button"
            onClick={async () => {
              await navigator.clipboard?.writeText(link);
              setCopied(true);
            }}
          >
            {copied ? "Copiado" : "Copiar enlace"}
          </button>
        </div>
      )}
    </form>
  );
}

function ProjectSettings({ project, onSaved }: { project: Project; onSaved: () => void }) {
  const [name, setName] = useState(project.name);
  const [idea, setIdea] = useState(project.initialIdea);
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);

  async function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await client.projects.update(project.id, { name, initialIdea: idea });
      setSaved(true);
      onSaved();
    } catch (err) {
      setError(err);
    }
  }

  const [deleting, setDeleting] = useState(false);

  return (
    <form className="panel stack" onSubmit={save}>
      <h3>Ajustes del proyecto</h3>
      {error ? <Notice>{errorText(error)}</Notice> : null}
      {saved && <Notice kind="ok" onClose={() => setSaved(false)}>Cambios guardados.</Notice>}
      <label>
        Nombre
        <input required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label>
        Idea inicial
        <textarea required rows={4} value={idea} onChange={(e) => setIdea(e.target.value)} />
      </label>
      <div className="row">
        <button type="submit">Guardar cambios</button>
        <button type="button" className="danger" onClick={() => setDeleting(true)}>
          Eliminar proyecto
        </button>
      </div>
      {deleting && (
        <ConfirmDialog
          title="Eliminar proyecto"
          confirmText={project.name}
          actionLabel="Eliminar definitivamente"
          onClose={() => setDeleting(false)}
          onConfirm={async () => {
            await client.projects.remove(project.id);
            navigate(paths.projects());
          }}
        >
          <p>
            Se borran sus etapas, conversaciones, preguntas y documentos para todos los miembros.
            No se puede deshacer.
          </p>
        </ConfirmDialog>
      )}
    </form>
  );
}
