import { type FormEvent, useEffect, useState } from "react";
import { client } from "../api";
import { useAuth } from "../auth";
import { navigate, paths } from "../router";
import { errorText, Notice } from "../ui";

const SSO_ERRORS: Record<string, string> = {
  sso_cancelado: "Cancelaste el inicio con Google.",
  sso_fallo: "No pudimos validar tu cuenta de Google. Intenta de nuevo.",
  sso_correo_no_verificado: "Tu correo de Google no está verificado, así que no podemos usarlo.",
};

/** Botón de Google, solo si el backend lo tiene configurado. */
function SsoButtons({ next }: { next?: string }) {
  const [providers, setProviders] = useState<string[]>([]);
  useEffect(() => {
    client.auth.ssoProviders().then((r) => setProviders(r.providers)).catch(() => {});
  }, []);
  if (!providers.includes("google")) return null;
  return (
    <>
      <a className="button sso" href={client.auth.ssoStartUrl("google", next)}>
        Continuar con Google
      </a>
      <p className="or muted">o con tu correo</p>
    </>
  );
}

function AuthFrame({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="auth">
      <div className="auth-intro">
        <p className="wordmark">Longanizator</p>
        <p className="lede">
          De una idea suelta a dos documentos que otra IA puede implementar, en seis etapas
          revisadas por tu equipo.
        </p>
        <p className="typed" aria-hidden="true">
          <span>idea → preguntas bloqueantes</span>
          <span>datos → api → pantallas → arquitectura</span>
          <span>✓ especificación lista para implementar</span>
        </p>
      </div>
      <section className="auth-form">
        <h1>{title}</h1>
        {children}
      </section>
    </main>
  );
}

export function LoginPage({ next, ssoError }: { next?: string; ssoError?: string }) {
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
        {ssoError && !error
          ? <Notice>{SSO_ERRORS[ssoError] ?? "No se pudo iniciar sesión con Google."}</Notice>
          : null}
        {error ? <Notice>{errorText(error)}</Notice> : null}
        <SsoButtons next={next} />
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
        <SsoButtons next={next} />
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
