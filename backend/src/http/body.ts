import type { Context } from "hono";
import { ApiError } from "./errors.ts";

/** Lee el cuerpo JSON como objeto. JSON mal formado o que no es objeto responde 400. */
export async function readJsonObject(c: Context): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw new ApiError("BAD_REQUEST", "El cuerpo debe ser JSON válido");
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new ApiError("BAD_REQUEST", "El cuerpo debe ser un objeto JSON");
  }
  return body as Record<string, unknown>;
}

/**
 * Acumula errores de validación por campo y, si hay alguno, lanza 422 con
 * `details: { fields: { campo: "mensaje" } }`.
 */
export class Validator {
  private errors: Record<string, string> = {};

  constructor(private body: Record<string, unknown>) {}

  string(
    field: string,
    opts: { min?: number; max?: number; trim?: boolean; pattern?: RegExp; patternMsg?: string } =
      {},
  ): string {
    const raw = this.body[field];
    if (typeof raw !== "string") {
      this.errors[field] = "Es obligatorio y debe ser texto";
      return "";
    }
    const value = opts.trim === false ? raw : raw.trim();
    if (opts.min !== undefined && value.length < opts.min) {
      this.errors[field] = opts.min <= 1 ? "Es obligatorio" : `Mínimo ${opts.min} caracteres`;
    } else if (opts.max !== undefined && value.length > opts.max) {
      this.errors[field] = `Máximo ${opts.max} caracteres`;
    } else if (opts.pattern && !opts.pattern.test(value)) {
      this.errors[field] = opts.patternMsg ?? "Formato inválido";
    }
    return value;
  }

  /** Agrega un error manual (reglas que no encajan en `string`). */
  fail(field: string, message: string) {
    this.errors[field] ??= message;
  }

  done() {
    if (Object.keys(this.errors).length > 0) {
      throw new ApiError("VALIDATION_ERROR", "Datos inválidos", { fields: this.errors });
    }
  }
}

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
