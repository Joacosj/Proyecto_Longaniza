import { Hono } from "hono";
import type { AuthDeps } from "./auth/session.ts";
import type { Engine } from "./engine/types.ts";
import { ApiError } from "./http/errors.ts";
import { bodyLimit, clientIp, rateLimit, securityHeaders } from "./http/security.ts";
import { architectureRoutes } from "./routes/architectures.ts";
import { agentCatalogRoutes } from "./routes/agents.ts";
import { authRoutes } from "./routes/auth.ts";
import { type HealthDeps, healthRoutes } from "./routes/health.ts";
import { invitationRoutes } from "./routes/members.ts";
import { projectRoutes } from "./routes/projects.ts";
import { type SsoDeps, ssoRoutes } from "./routes/sso.ts";

export type AppDeps = HealthDeps & AuthDeps & Pick<SsoDeps, "sso" | "appUrl"> & {
  /** Motor de IA (mitad B). Mientras no esté listo, `createFakeEngine()`. */
  engine: Engine;
  /** En producción se agrega HSTS. */
  production?: boolean;
  /** Límites por IP; las pruebas los pueden relajar. */
  limits?: { auth: number; ai: number };
};

/**
 * Construye la app sin abrir conexiones, para poder probarla con dependencias falsas.
 * Cada épica registra sus rutas aquí bajo /api.
 */
export function createApp(deps: AppDeps) {
  const app = new Hono().basePath("/api");
  const limits = deps.limits ?? { auth: 10, ai: 30 };

  app.use("*", securityHeaders({ production: deps.production ?? false }));
  app.use("*", bodyLimit(2 * 1024 * 1024));
  // Fuerza bruta: 10 intentos de acceso o registro por IP cada 5 minutos.
  for (const path of ["/auth/login", "/auth/register"]) {
    app.use(
      path,
      rateLimit({
        max: limits.auth,
        windowMs: 5 * 60_000,
        key: (c) => `auth:${clientIp(c)}`,
        message: "Demasiados intentos. Espera unos minutos antes de volver a intentar.",
      }),
    );
  }
  // Créditos de IA: 30 acciones con IA por IP cada 10 minutos.
  const aiPaths = [
    "/projects/:id/stages/:kind/generate",
    "/projects/:id/messages",
    "/projects/:id/inconsistencies/:incId/resolution",
    "/projects/:id/semantic-audit",
    "/projects/:id/external-review",
    "/projects/:id/screens/:screenId/preview",
  ];
  for (const path of aiPaths) {
    app.on(
      "POST",
      path,
      rateLimit({
        max: limits.ai,
        windowMs: 10 * 60_000,
        key: (c) => `ai:${clientIp(c)}`,
        message: "Se alcanzó el límite de acciones con IA. Espera unos minutos.",
      }),
    );
  }

  app.route("/health", healthRoutes(deps));
  app.route("/auth/sso", ssoRoutes(deps));
  app.route("/auth", authRoutes(deps));
  app.route("/projects", projectRoutes(deps));
  app.route("/invitations", invitationRoutes(deps));
  app.route("/architectures", architectureRoutes(deps));
  app.route("/agents", agentCatalogRoutes(deps));

  app.notFound((c) => c.json(new ApiError("NOT_FOUND", "Ruta no encontrada").toBody(), 404));

  app.onError((err, c) => {
    if (err instanceof ApiError) {
      return c.json(err.toBody(), err.status as 400);
    }
    console.error(err);
    return c.json(new ApiError("INTERNAL", "Error interno").toBody(), 500);
  });

  return app;
}
