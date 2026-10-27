import { Hono } from "hono";
import type { AuthDeps } from "./auth/session.ts";
import type { Engine } from "./engine/types.ts";
import { ApiError } from "./http/errors.ts";
import { architectureRoutes } from "./routes/architectures.ts";
import { authRoutes } from "./routes/auth.ts";
import { type HealthDeps, healthRoutes } from "./routes/health.ts";
import { invitationRoutes } from "./routes/members.ts";
import { projectRoutes } from "./routes/projects.ts";

export type AppDeps = HealthDeps & AuthDeps & {
  /** Motor de IA (mitad B). Mientras no esté listo, `createFakeEngine()`. */
  engine: Engine;
};

/**
 * Construye la app sin abrir conexiones, para poder probarla con dependencias falsas.
 * Cada épica registra sus rutas aquí bajo /api.
 */
export function createApp(deps: AppDeps) {
  const app = new Hono().basePath("/api");

  app.route("/health", healthRoutes(deps));
  app.route("/auth", authRoutes(deps));
  app.route("/projects", projectRoutes(deps));
  app.route("/invitations", invitationRoutes(deps));
  app.route("/architectures", architectureRoutes(deps));

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
