/**
 * Formato único de error de la API:
 *   { "error": { "code": "FORBIDDEN", "message": "...", "details": {...} } }
 *
 * 401 = no hay identidad válida. 403 = hay identidad, pero sin permiso sobre el recurso.
 * 409 = conflicto de versión (edición concurrente) o estado inválido.
 */
export type ErrorCode =
  | "BAD_REQUEST"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "VALIDATION_ERROR"
  | "PAYLOAD_TOO_LARGE"
  | "RATE_LIMITED"
  | "INTERNAL";

const STATUS: Record<ErrorCode, 400 | 401 | 403 | 404 | 409 | 413 | 422 | 429 | 500> = {
  BAD_REQUEST: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  VALIDATION_ERROR: 422,
  PAYLOAD_TOO_LARGE: 413,
  RATE_LIMITED: 429,
  INTERNAL: 500,
};

export class ApiError extends Error {
  readonly status: number;
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.status = STATUS[code];
  }

  toBody() {
    return { error: { code: this.code, message: this.message, details: this.details } };
  }
}
