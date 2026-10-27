import { type FormEvent, useState } from "react";
import { useAuth } from "../auth";
import { navigate, paths } from "../router";
import { errorText, Notice } from "../ui";

function AuthFrame({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="auth">
      <div className="auth-intro">
        <p className="wordmark">Ideator</p>
        <p className="lede">
          De una idea suelta a dos documentos que otra IA puede implementar, en seis etapas
          revisadas por tu equipo.
        </p>
      </div>
      <section className="auth-form">
        <h1>{title}</h1>
        {children}
      </section>
    </main>
  );
}

export function LoginPage({ next }: { next?: string }) {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await login(email, password);
      navigate(next ?? paths.projects());
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthFrame title="Iniciar sesión">
      <form onSubmit={submit} className="stack">
        {error ? <Notice>{errorText(error)}</Notice> : null}
        <label>
          Correo
          <input
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label>
          Contraseña
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <button type="submit" className="primary" disabled={busy}>
          {busy ? "Entrando…" : "Iniciar sesión"}
        </button>
        <p className="muted">
          ¿No tienes cuenta? <a href={paths.register(next)}>Crear cuenta</a>
        </p>
      </form>
    </AuthFrame>
  );
}

export function RegisterPage({ next }: { next?: string }) {
  const { register } = useAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await register(email, name, password);
      navigate(next ?? paths.projects());
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthFrame title="Crear cuenta">
      <form onSubmit={submit} className="stack">
        {error ? <Notice>{errorText(error)}</Notice> : null}
        <label>
          Nombre
          <input autoComplete="name" required value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          Correo
          <input
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label>
          Contraseña
          <input
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <small className="muted">Mínimo 8 caracteres.</small>
        </label>
        <button type="submit" className="primary" disabled={busy}>
          {busy ? "Creando…" : "Crear cuenta"}
        </button>
        <p className="muted">
          ¿Ya tienes cuenta? <a href={paths.login(next)}>Iniciar sesión</a>
        </p>
      </form>
    </AuthFrame>
  );
}
