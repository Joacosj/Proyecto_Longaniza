import { useEffect, useState } from "react";
import { client } from "../api";
import type { StageComponentProps } from "../types";
import { errorText } from "../ui";
import type { ArchitectureArtifact, ArchitectureTemplate } from "./contracts";

/**
 * Etapa 5: las cinco opciones del catálogo, la elegida destacada con su justificación, y
 * las descartadas con su razón.
 */
export function ArchitectureStage(
  { artifact, editable, onChange }: StageComponentProps<ArchitectureArtifact>,
) {
  const [catalog, setCatalog] = useState<ArchitectureTemplate[] | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    client.architectures()
      .then((r) => setCatalog(r.architectures as unknown as ArchitectureTemplate[]))
      .catch(setError);
  }, []);

  const discarded = artifact.discarded ?? [];
  const reasonFor = (key: string) => discarded.find((d) => d.key === key)?.reason ?? "";

  /** Elegir otra opción: la anterior pasa a descartada (conservando razones ya escritas). */
  function choose(key: string) {
    if (!catalog) return;
    const keep = new Map(discarded.map((d) => [d.key, d.reason]));
    onChange({
      ...artifact,
      selectedKey: key,
      discarded: catalog
        .filter((a) => a.key !== key)
        .map((a) => ({ key: a.key, reason: keep.get(a.key) ?? "" })),
    });
  }

  function setReason(key: string, reason: string) {
    const exists = discarded.some((d) => d.key === key);
    onChange({
      ...artifact,
      discarded: exists
        ? discarded.map((d) => (d.key === key ? { ...d, reason } : d))
        : [...discarded, { key, reason }],
    });
  }

  if (error) return <p className="field-error">No se pudo cargar el catálogo: {errorText(error)}</p>;
  if (!catalog) return <p className="muted">Cargando catálogo de arquitecturas…</p>;

  const selected = catalog.find((a) => a.key === artifact.selectedKey);
  const others = catalog.filter((a) => a.key !== artifact.selectedKey);

  return (
    <div className="arch stack">
      {selected
        ? (
          <section className="arch-chosen" aria-labelledby="arch-chosen-title">
            <span className="flag flag-ok">Elegida</span>
            <h3 id="arch-chosen-title">{selected.name}</h3>
            <p className="muted">{selected.summary}</p>
            <h4>Por qué calza con este producto</h4>
            {editable
              ? (
                <textarea
                  aria-label="Justificación"
                  rows={5}
                  value={artifact.justification ?? ""}
                  onChange={(e) => onChange({ ...artifact, justification: e.target.value })}
                />
              )
              : <p className="arch-why">{artifact.justification}</p>}
            <TemplateFacts t={selected} />
          </section>
        )
        : (
          <p className="notice notice-warn">
            La etapa elige “{artifact.selectedKey || "ninguna"}”, que no está en el catálogo.
            {editable ? " Elige una de las opciones de abajo." : ""}
          </p>
        )}

      <section>
        <h3>Descartadas</h3>
        <ul className="arch-list">
          {others.map((a) => (
            <li key={a.key} className="arch-option">
              <div className="arch-option-head">
                <h4>{a.name}</h4>
                {editable && (
                  <button type="button" onClick={() => choose(a.key)}>Elegir esta</button>
                )}
              </div>
              <p className="muted small">{a.summary}</p>
              {editable
                ? (
                  <label className="small">
                    Por qué se descarta
                    <textarea rows={2} value={reasonFor(a.key)} onChange={(e) => setReason(a.key, e.target.value)} />
                  </label>
                )
                : (
                  <p>
                    <strong>Por qué se descarta:</strong>{" "}
                    {reasonFor(a.key) || <span className="muted">sin razón indicada</span>}
                  </p>
                )}
              <details>
                <summary>Ver características</summary>
                <TemplateFacts t={a} />
              </details>
            </li>
          ))}
        </ul>
      </section>

      <Decisions artifact={artifact} />
    </div>
  );
}

function TemplateFacts({ t }: { t: ArchitectureTemplate }) {
  const rows: [string, string][] = [
    ["Persistencia", t.persistence],
    ["Backend", t.backend],
    ["Frontend", t.frontend],
    ["Comunicación", t.communication],
    ["Infraestructura", t.infrastructure],
    ["Operación", t.operation],
    ["Autenticación", t.auth],
  ];
  return (
    <dl className="facts">
      {rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
      {t.bestFor?.length > 0 && <div><dt>Ideal para</dt><dd>{t.bestFor.join("; ")}</dd></div>}
      {t.notRecommendedWhen?.length > 0 && (
        <div><dt>Evitar si</dt><dd>{t.notRecommendedWhen.join("; ")}</dd></div>
      )}
    </dl>
  );
}

/** Decisiones concretas del proyecto (stack, despliegue, observabilidad, autenticación). */
function Decisions({ artifact }: { artifact: ArchitectureArtifact }) {
  const { stack, deployment, observability, auth } = artifact;
  if (!stack && !deployment && !observability && !auth) return null;
  return (
    <section>
      <h3>Decisiones para este proyecto</h3>
      <div className="decisions">
        {stack && (
          <div>
          <h4>Stack</h4>
          <dl className="facts">
            <div><dt>Base de datos</dt><dd>{stack.database}</dd></div>
            <div><dt>Backend</dt><dd>{stack.backend}</dd></div>
            <div><dt>Frontend</dt><dd>{stack.frontend}</dd></div>
            <div><dt>Comunicación</dt><dd>{stack.communication}</dd></div>
          </dl>
          </div>
        )}
        {deployment && (
          <div>
          <h4>Despliegue</h4>
          <dl className="facts">
            <div><dt>Despliegue</dt><dd>{deployment.strategy}</dd></div>
            <div><dt>Ambientes</dt><dd>{(deployment.environments ?? []).join(", ")}</dd></div>
            {(deployment.envVars ?? []).length > 0 && (
              <div>
                <dt>Variables</dt>
                <dd>{deployment.envVars.map((v) => <code key={v.name} title={v.purpose}>{v.name} </code>)}</dd>
              </div>
            )}
          </dl>
          </div>
        )}
        {observability && (
          <div>
          <h4>Observabilidad</h4>
          <dl className="facts">
            <div><dt>Logs</dt><dd>{observability.logging}</dd></div>
            <div><dt>Métricas</dt><dd>{observability.metrics}</dd></div>
            <div><dt>Trazas</dt><dd>{observability.tracing}</dd></div>
            <div><dt>Salud</dt><dd>{observability.healthChecks}</dd></div>
          </dl>
          </div>
        )}
        {auth && (
          <div>
          <h4>Autenticación</h4>
          <dl className="facts">
            <div><dt>Identidad</dt><dd>{auth.identity}</dd></div>
            <div><dt>SSO</dt><dd>{auth.sso}</dd></div>
            <div><dt>Sesión</dt><dd>{auth.session}</dd></div>
            <div><dt>Autorización</dt><dd>{auth.authorization}</dd></div>
          </dl>
          </div>
        )}
      </div>
    </section>
  );
}

export default ArchitectureStage;
