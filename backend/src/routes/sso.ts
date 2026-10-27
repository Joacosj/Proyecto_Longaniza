import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { type AuthDeps, startSession } from "../auth/session.ts";
import { pkceChallenge, SsoError, type SsoProvider } from "../auth/sso.ts";
import { generateToken, signValue, verifySignedValue } from "../auth/tokens.ts";
import { ApiError } from "../http/errors.ts";
import { inTransaction } from "../repositories/tx.ts";
import { identitiesRepo, usersRepo } from "../repositories/users.ts";

export type SsoDeps = AuthDeps & {
  /** Proveedores configurados, por nombre ("google"). Vacío = SSO desactivado. */
  sso?: Record<string, SsoProvider>;
  /** URL pública del frontend: allí vuelve el navegador y desde ahí se arma el callback. */
  appUrl?: string;
};

const FLOW_COOKIE = "ideator_sso";
const FLOW_PATH = "/api/auth/sso";
const FLOW_TTL_SECONDS = 10 * 60;

interface FlowState {
  provider: string;
  state: string;
  nonce: string;
  verifier: string;
  next: string;
  createdAt: number;
}

/** Solo rutas internas del frontend (#/...), para no redirigir a sitios externos. */
function safeNext(value: string | undefined): string {
  return value && /^#\/[A-Za-z0-9\-._~/?=&%]*$/.test(value) ? value : "#/proyectos";
}

export function ssoRoutes(deps: SsoDeps) {
  const r = new Hono();
  const providers = deps.sso ?? {};
  const appUrl = (deps.appUrl ?? "http://localhost:5173").replace(/\/$/, "");
  const callbackUrl = (name: string) => `${appUrl}${FLOW_PATH}/${name}/callback`;
  const failTo = (reason: string) => `${appUrl}/#/login?error=${encodeURIComponent(reason)}`;

  const provider = (name: string) => {
    const p = providers[name];
    if (!p) throw new ApiError("NOT_FOUND", "Proveedor de identidad no disponible");
    return p;
  };

  /** Qué proveedores están activos, para que la interfaz muestre sus botones. */
  r.get("/providers", (c) => c.json({ providers: Object.keys(providers) }));

  r.get("/:provider/start", async (c) => {
    const p = provider(c.req.param("provider"));
    const flow: FlowState = {
      provider: p.name,
      state: generateToken(),
      nonce: generateToken(),
      verifier: generateToken(),
      next: safeNext(c.req.query("next")),
      createdAt: Date.now(),
    };
    setCookie(c, FLOW_COOKIE, await signValue(flow, deps.sessionSecret), {
      httpOnly: true,
      // Lax: el navegador la envía cuando Google lo redirige de vuelta (navegación GET).
      sameSite: "Lax",
      secure: deps.secureCookies ?? false,
      path: FLOW_PATH,
      maxAge: FLOW_TTL_SECONDS,
    });
    return c.redirect(
      p.authorizationUrl({
        state: flow.state,
        nonce: flow.nonce,
        codeChallenge: await pkceChallenge(flow.verifier),
        redirectUri: callbackUrl(p.name),
      }),
      302,
    );
  });

  r.get("/:provider/callback", async (c) => {
    const p = provider(c.req.param("provider"));

    const raw = getCookie(c, FLOW_COOKIE);
    const flow = raw ? await verifySignedValue<FlowState>(raw, deps.sessionSecret) : undefined;
    deleteCookie(c, FLOW_COOKIE, { path: FLOW_PATH, secure: deps.secureCookies ?? false });

    // El state protege contra CSRF: debe coincidir con el que guardamos al iniciar.
    if (
      !flow || flow.provider !== p.name || flow.state !== c.req.query("state") ||
      Date.now() - flow.createdAt > FLOW_TTL_SECONDS * 1000
    ) {
      throw new ApiError(
        "BAD_REQUEST",
        "La sesión de inicio con el proveedor no es válida o expiró",
      );
    }

    // El usuario canceló en el proveedor o este devolvió un error.
    if (c.req.query("error")) return c.redirect(failTo("sso_cancelado"), 302);
    const code = c.req.query("code");
    if (!code) throw new ApiError("BAD_REQUEST", "Falta el código del proveedor");

    let claims;
    try {
      claims = await p.exchange({
        code,
        codeVerifier: flow.verifier,
        redirectUri: callbackUrl(p.name),
        nonce: flow.nonce,
      });
    } catch (err) {
      if (err instanceof SsoError) {
        console.warn(`SSO ${p.name}: ${err.message}`);
        return c.redirect(failTo("sso_fallo"), 302);
      }
      throw err;
    }

    const user = await inTransaction(deps.sql, async (tx) => {
      const identities = identitiesRepo(tx);
      const linked = await identities.findUser(p.name, claims.subject);
      if (linked) return linked;

      const users = usersRepo(tx);
      const byEmail = await users.findByEmail(claims.email);
      if (byEmail) {
        // Solo se enlaza a una cuenta existente si el proveedor verificó el correo; si no,
        // cualquiera con una cuenta en el proveedor podría tomar la cuenta local.
        if (!claims.emailVerified) return null;
        await identities.link(byEmail.id, p.name, claims.subject);
        return { id: byEmail.id, email: byEmail.email, name: byEmail.name };
      }

      if (!claims.emailVerified) return null;
      const created = await users.create({
        email: claims.email,
        name: claims.name.slice(0, 100),
        passwordHash: null,
      });
      await identities.link(created.id, p.name, claims.subject);
      return created;
    });

    if (!user) return c.redirect(failTo("sso_correo_no_verificado"), 302);

    await startSession(c, deps, user.id);
    return c.redirect(`${appUrl}/${flow.next}`, 302);
  });

  return r;
}
