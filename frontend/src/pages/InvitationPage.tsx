import { useRef, useState } from "react";
import { client } from "../api";
import { useAuth } from "../auth";
import { navigate, paths } from "../router";
import { errorText, Notice } from "../ui";

export function InvitationPage({ token }: { token: string }) {
  const { user } = useAuth();
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const here = paths.invitation(token);
  /** Evita enviar la aceptación dos veces (doble clic antes de que se re-renderice). */
  const sent = useRef(false);

  async function accept() {
    if (sent.current) return;
    sent.current = true;
    setBusy(true);
    setError(null);
    try {
      const { projectId } = await client.members.accept(token);
      navigate(paths.stage(projectId));
    } catch (err) {
      setError(err);
      setBusy(false);
      sent.current = false;
    }
  }

  return (
    <main className="page narrow">
      <h1>Te invitaron a un proyecto</h1>
      {!user
        ? (
          <>
            <p>Para aceptar, entra con la cuenta del correo al que llegó la invitación.</p>
            <div className="row">
              <a className="button primary" href={paths.login(here)}>Iniciar sesión</a>
              <a className="button" href={paths.register(here)}>Crear cuenta</a>
            </div>
          </>
        )
        : (
          <>
            <p>Vas a unirte como <strong>{user.email}</strong>.</p>
            {error ? <Notice>{errorText(error)}</Notice> : null}
            <button type="button" className="primary" onClick={accept} disabled={busy}>
              {busy ? "Uniéndote…" : "Aceptar invitación"}
            </button>
          </>
        )}
    </main>
  );
}
