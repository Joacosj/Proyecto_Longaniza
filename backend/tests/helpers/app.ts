import { type AppDeps, createApp } from "../../src/app.ts";
import type { Sql } from "../../src/db/client.ts";
import { createFakeEngine } from "../../src/engine/fake.ts";

// Hash rápido en pruebas; en producción se usa el costo por defecto.
Deno.env.set("BCRYPT_COST", "4");

export const TEST_SECRET = "test-secret-solo-para-pruebas-0123456789";

/** Una base que falla si alguien la usa: para probar rutas que no deberían tocarla. */
const noDb = new Proxy(() => {}, {
  get: () => {
    throw new Error("Esta prueba no debería usar la base de datos");
  },
  apply: () => {
    throw new Error("Esta prueba no debería usar la base de datos");
  },
}) as unknown as Sql;

export function buildApp(overrides: Partial<AppDeps> = {}) {
  return createApp({
    pingDb: () => Promise.resolve(),
    sql: noDb,
    sessionSecret: TEST_SECRET,
    engine: createFakeEngine(),
    limits: { auth: 1000, ai: 1000 },
    ...overrides,
  });
}

type App = ReturnType<typeof buildApp>;

/**
 * Cliente que guarda la cookie de sesión entre llamadas, como lo haría un navegador.
 * Cada instancia representa a un usuario distinto.
 */
export class TestClient {
  /** Cookie de sesión (`ideator_session=...`), o "" si no hay. */
  cookie = "";
  /** Otras cookies que el servidor dejó (ej. la del flujo SSO). */
  extra = new Map<string, string>();

  constructor(private app: App) {}

  async request(method: string, path: string, body?: unknown): Promise<Response> {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const all = [this.cookie, ...[...this.extra].map(([k, v]) => `${k}=${v}`)].filter(Boolean);
    if (all.length) headers["Cookie"] = all.join("; ");

    const res = await this.app.request(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    for (const raw of res.headers.getSetCookie()) {
      const [pair] = raw.split(";");
      const eq = pair.indexOf("=");
      const name = pair.slice(0, eq);
      const value = pair.slice(eq + 1);
      const expired = /max-age=0/i.test(raw) || /expires=Thu, 01 Jan 1970/i.test(raw);
      if (name === "ideator_session") {
        this.cookie = expired || !value ? "" : `${name}=${value}`;
      } else if (expired || !value) {
        this.extra.delete(name);
      } else {
        this.extra.set(name, value);
      }
    }
    return res;
  }

  get(path: string) {
    return this.request("GET", path);
  }
  post(path: string, body?: unknown) {
    return this.request("POST", path, body);
  }
  put(path: string, body?: unknown) {
    return this.request("PUT", path, body);
  }
  patch(path: string, body?: unknown) {
    return this.request("PATCH", path, body);
  }
  delete(path: string) {
    return this.request("DELETE", path);
  }

  /** Registra un usuario y queda con su sesión. */
  async register(email: string, name = "Usuario", password = "contraseña-segura") {
    const res = await this.post("/api/auth/register", { email, name, password });
    if (res.status !== 201) throw new Error(`register falló: ${res.status} ${await res.text()}`);
    return (await res.json()).user as { id: string; email: string; name: string };
  }
}

/**
 * El owner invita a `member` (por su correo) y este acepta. Deja a `member` en el proyecto
 * con el rol indicado, usando las rutas reales de invitación.
 */
export async function joinProject(
  owner: TestClient,
  member: TestClient,
  memberEmail: string,
  projectId: string,
  role: "editor" | "viewer",
) {
  const inv = await owner.post(`/api/projects/${projectId}/invitations`, {
    email: memberEmail,
    role,
  });
  if (inv.status !== 201) throw new Error(`invitar falló: ${inv.status} ${await inv.text()}`);
  const { token } = await inv.json();
  const acc = await member.post(`/api/invitations/${token}/accept`);
  if (acc.status !== 200) throw new Error(`aceptar falló: ${acc.status} ${await acc.text()}`);
}
