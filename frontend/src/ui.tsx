/** Piezas pequeñas compartidas por las pantallas. */
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "./api";
import type { ProjectRole } from "./types";
import { ROLE_LABEL } from "./types";

/** Mensaje de error legible a partir de cualquier excepción. */
export function errorText(err: unknown): string {
  if (err instanceof ApiError) {
    const fields = (err.details as { fields?: Record<string, string> } | undefined)?.fields;
    if (fields) {
      return Object.entries(fields).map(([k, v]) => `${k}: ${v}`).join(" · ");
    }
    return err.message;
  }
  if (err instanceof TypeError) return "No hay conexión con el servidor.";
  return err instanceof Error ? err.message : String(err);
}

export function Notice(
  { kind = "error", children, onClose }: {
    kind?: "error" | "info" | "warn" | "ok";
    children: ReactNode;
    onClose?: () => void;
  },
) {
  return (
    <div className={`notice notice-${kind}`} role={kind === "error" ? "alert" : "status"}>
      <div className="notice-body">{children}</div>
      {onClose && (
        <button type="button" className="link" onClick={onClose} aria-label="Cerrar aviso">
          Cerrar
        </button>
      )}
    </div>
  );
}

/**
 * Confirmación para acciones que no se pueden deshacer. Exige escribir un texto (por ejemplo,
 * el nombre del proyecto) para evitar borrar algo por un clic accidental.
 */
export function ConfirmDialog(
  { title, children, confirmText, actionLabel, onConfirm, onClose }: {
    title: string;
    children: ReactNode;
    confirmText: string;
    actionLabel: string;
    onConfirm: () => Promise<void>;
    onClose: () => void;
  },
) {
  const ref = useRef<HTMLDialogElement>(null);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <dialog ref={ref} className="confirm" onClose={onClose} aria-labelledby="confirm-title">
      <div className="stack">
        <h2 id="confirm-title">{title}</h2>
        <div>{children}</div>
        {error ? <Notice>{errorText(error)}</Notice> : null}
        <label>
          <span>Escribe <code>{confirmText}</code> para confirmar</span>
          <input value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus />
        </label>
        <div className="row">
          <button
            type="button"
            className="danger"
            disabled={busy || typed.trim() !== confirmText}
            onClick={confirm}
          >
            {busy ? "Eliminando…" : actionLabel}
          </button>
          <button type="button" onClick={() => ref.current?.close()} disabled={busy}>Cancelar</button>
        </div>
      </div>
    </dialog>
  );
}

export function RoleTag({ role }: { role: ProjectRole }) {
  return <span className={`role role-${role}`}>{ROLE_LABEL[role]}</span>;
}

export function Loading({ label = "Cargando…" }: { label?: string }) {
  return <p className="muted loading">{label}</p>;
}

const dateFmt = new Intl.DateTimeFormat("es-CL", { dateStyle: "medium", timeStyle: "short" });
export const formatDate = (iso: string | null | undefined) => (iso ? dateFmt.format(new Date(iso)) : "");

/**
 * Carga datos con una función asíncrona y expone `reload`. Evita repetir el patrón
 * loading/error/data en cada pantalla.
 */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setData(await fn());
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    reload();
  }, [reload]);

  return { data, error, loading, reload, setData };
}
