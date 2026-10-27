import { Fragment, useState } from "react";
import type { StageComponentProps } from "../types";
import type { BackendArtifact, Field } from "./contracts";

type Endpoint = BackendArtifact["endpoints"][number];
const METHODS: Endpoint["method"][] = ["GET", "POST", "PUT", "PATCH", "DELETE"];

const STATUS_TEXT: Record<number, string> = {
  200: "OK",
  201: "Creado",
  204: "Sin contenido",
  400: "Solicitud inválida",
  401: "Sin sesión",
  403: "Sin permiso",
  404: "No existe",
  409: "Conflicto",
  422: "Datos inválidos",
  500: "Error interno",
};

/**
 * Etapa 3: tabla de endpoints (método, ruta, roles) con el detalle de entradas, respuestas
 * y códigos al expandir cada fila.
 */
export function BackendStage({ artifact, editable, onChange }: StageComponentProps<BackendArtifact>) {
  const endpoints = artifact.endpoints ?? [];
  const [open, setOpen] = useState<Set<string>>(new Set());

  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const updateEndpoint = (i: number, patch: Partial<Endpoint>) =>
    onChange({ ...artifact, endpoints: endpoints.map((e, j) => (j === i ? { ...e, ...patch } : e)) });

  const removeEndpoint = (i: number) =>
    onChange({ ...artifact, endpoints: endpoints.filter((_, j) => j !== i) });

  return (
    <div className="be stack">
      <section className="be-overview">
        {editable
          ? (
            <label>
              Resumen de la API
              <textarea
                rows={3}
                value={artifact.overview ?? ""}
                onChange={(e) => onChange({ ...artifact, overview: e.target.value })}
              />
            </label>
          )
          : <p>{artifact.overview}</p>}
        {artifact.auth && (
          <p className="muted">
            <strong>Autenticación:</strong> {artifact.auth.scheme}
            {artifact.auth.description ? `. ${artifact.auth.description}` : ""}
          </p>
        )}
      </section>

      {endpoints.length === 0
        ? <p className="muted">La etapa no define endpoints todavía.</p>
        : (
          <div className="table-scroll">
            <table className="table be-table">
              <thead>
                <tr>
                  <th scope="col">Método</th>
                  <th scope="col">Ruta</th>
                  <th scope="col">Qué hace</th>
                  <th scope="col">Roles</th>
                  <th scope="col"><span className="sr-only">Detalle</span></th>
                </tr>
              </thead>
              <tbody>
                {endpoints.map((ep, i) => {
                  const isOpen = open.has(ep.id);
                  return (
                    <Fragment key={ep.id ?? i}>
                      <tr className={isOpen ? "is-open" : undefined}>
                        <td>
                          {editable
                            ? (
                              <select
                                aria-label={`Método de ${ep.id}`}
                                value={ep.method}
                                onChange={(e) => updateEndpoint(i, { method: e.target.value as Endpoint["method"] })}
                              >
                                {METHODS.map((m) => <option key={m}>{m}</option>)}
                              </select>
                            )
                            : <span className={`method method-${ep.method}`}>{ep.method}</span>}
                        </td>
                        <td>
                          {editable
                            ? (
                              <input
                                aria-label={`Ruta de ${ep.id}`}
                                className="mono"
                                value={ep.path}
                                onChange={(e) => updateEndpoint(i, { path: e.target.value })}
                              />
                            )
                            : <code>{ep.path}</code>}
                        </td>
                        <td>
                          {editable
                            ? (
                              <input
                                aria-label={`Resumen de ${ep.id}`}
                                value={ep.summary}
                                onChange={(e) => updateEndpoint(i, { summary: e.target.value })}
                              />
                            )
                            : ep.summary}
                        </td>
                        <td><Roles endpoint={ep} /></td>
                        <td className="be-actions">
                          <button
                            type="button"
                            className="link"
                            aria-expanded={isOpen}
                            aria-controls={`ep-${ep.id}`}
                            onClick={() => toggle(ep.id)}
                          >
                            {isOpen ? "Ocultar" : "Detalle"}
                          </button>
                        </td>
                      </tr>
                      {isOpen && (
                        <tr className="be-detail-row">
                          <td colSpan={5} id={`ep-${ep.id}`}>
                            <EndpointDetail endpoint={ep} />
                            {editable && (
                              <button type="button" className="link danger" onClick={() => removeEndpoint(i)}>
                                Quitar {ep.id}
                              </button>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      {editable && (
        <p className="muted small">
          Aquí editas lo esencial de cada endpoint. Para cambiar entradas y respuestas en
          detalle, usa “Editar como JSON” al final de la etapa.
        </p>
      )}
    </div>
  );
}

function Roles({ endpoint }: { endpoint: Endpoint }) {
  if (!endpoint.requiresAuth) return <span className="muted">Público</span>;
  const roles = endpoint.allowedRoleIds ?? [];
  if (roles.length === 0) return <span className="muted">Cualquier usuario con sesión</span>;
  return (
    <span className="chips">
      {roles.map((r) => <span key={r} className="chip">{r}</span>)}
    </span>
  );
}

function EndpointDetail({ endpoint }: { endpoint: Endpoint }) {
  const req = endpoint.request ?? { pathParams: [], queryParams: [], headers: [], body: [] };
  const groups: [string, Field[]][] = [
    ["Parámetros de ruta", req.pathParams ?? []],
    ["Parámetros de consulta", req.queryParams ?? []],
    ["Encabezados", req.headers ?? []],
    ["Cuerpo", req.body ?? []],
  ];
  const withFields = groups.filter(([, f]) => f.length > 0);

  return (
    <div className="be-detail">
      <p className="muted small">
        {endpoint.id}
        {endpoint.entities?.length ? ` · usa ${endpoint.entities.join(", ")}` : ""}
        {endpoint.requirementIds?.length ? ` · cubre ${endpoint.requirementIds.join(", ")}` : ""}
      </p>

      <div className="be-cols">
        <section>
          <h4>Entrada</h4>
          {withFields.length === 0
            ? <p className="muted">No recibe datos.</p>
            : withFields.map(([title, fields]) => (
              <div key={title}>
                <p className="be-group">{title}</p>
                <FieldList fields={fields} />
              </div>
            ))}
        </section>
        <section>
          <h4>Respuestas</h4>
          <ul className="responses">
            {(endpoint.responses ?? []).map((r, i) => (
              <li key={`${r.status}-${i}`}>
                <span className={`status status-${String(r.status)[0]}xx`}>{r.status}</span>{" "}
                <span className="muted">{STATUS_TEXT[r.status] ?? ""}</span>
                <p>{r.when}</p>
                {r.body?.length > 0 && r.status < 400 && <FieldList fields={r.body} />}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}

function FieldList({ fields }: { fields: Field[] }) {
  return (
    <ul className="fields">
      {fields.map((f) => (
        <li key={f.name}>
          <code>{f.name}</code> <span className="muted">{f.type}</span>
          {f.required ? <span className="req"> obligatorio</span> : <span className="muted"> opcional</span>}
          {f.validation && <span className="small"> · {f.validation}</span>}
          {f.description && <span className="small muted"> · {f.description}</span>}
        </li>
      ))}
    </ul>
  );
}

export default BackendStage;
