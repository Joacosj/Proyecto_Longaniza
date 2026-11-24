/**
 * Protección de datos a nivel HTTP:
 * - Cabeceras de seguridad en todas las respuestas de la API (sin caché, sin incrustar en
 *   otros sitios, sin adivinar tipos de contenido).
 * - Límite de tamaño del cuerpo, para que nadie pueda saturar el servidor con peticiones enormes.
 * - Límite de intentos por IP para el inicio de sesión, el registro y las acciones con IA, que
 *   frena ataques de fuerza bruta y el gasto descontrolado de créditos.
 */
import type { Context, MiddlewareHandler } from "hono";
import { ApiError } from "./errors.ts";

export function securityHeaders(opts: { production: boolean }): MiddlewareHandler {
  return async (c, next) => {
    await next();
    const h = c.res.headers;
    h.set("X-Content-Type-Options", "nosniff");
    h.set("X-Frame-Options", "DENY");
    h.set("Referrer-Policy", "no-referrer");
    h.set("Cross-Origin-Opener-Policy", "same-origin");
    h.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    h.set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
    if (!h.has("Cache-Control")) h.set("Cache-Control", "no-store");
    if (opts.production) h.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  };
}

export function bodyLimit(maxBytes: number): MiddlewareHandler {
  return async (c, next) => {
    const length = Number(c.req.header("content-length") ?? 0);
    if (length > maxBytes) {
      throw new ApiError("PAYLOAD_TOO_LARGE", `El cuerpo supera ${Math.round(maxBytes / 1024)} KB`);
    }
    await next();
  };
}

/** IP del cliente: detrás de un proxy (Cloud Run) viene en X-Forwarded-For. */
export function clientIp(c: Context): string {
  return c.req.header("x-forwarded-for")?.split(",")[0].trim() ||
    c.req.header("x-real-ip") || "local";
}

/**
 * Ventana deslizante en memoria: como máximo `max` peticiones por clave en `windowMs`.
 * Suficiente para una sola instancia; con varias instancias cada una cuenta por separado.
 */
export function rateLimit(opts: {
  max: number;
  windowMs: number;
  key: (c: Context) => string;
  message: string;
}): MiddlewareHandler {
  const hits = new Map<string, number[]>();
  return async (c, next) => {
    const now = Date.now();
    const key = opts.key(c);
    const recent = (hits.get(key) ?? []).filter((t) => now - t < opts.windowMs);
    if (recent.length >= opts.max) {
      const retry = Math.ceil((opts.windowMs - (now - recent[0])) / 1000);
      c.header("Retry-After", String(retry));
      throw new ApiError("RATE_LIMITED", opts.message, { retryAfterSeconds: retry });
    }
    recent.push(now);
    hits.set(key, recent);
    if (hits.size > 10_000) hits.clear(); // evita crecer sin límite
    await next();
  };
}
