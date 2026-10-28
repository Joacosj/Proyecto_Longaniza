import type { ReactNode } from "react";
import type { StageComponentProps } from "../types";
import type { DefinitionArtifact } from "./contracts";

type Def = DefinitionArtifact;

/** Siguiente id libre con un prefijo, ej. "REQ-7". */
function nextId(prefix: string, ids: string[]): string {
  const nums = ids.map((id) => Number(id.replace(`${prefix}-`, ""))).filter(Number.isFinite);
  return `${prefix}-${Math.max(0, ...nums) + 1}`;
}

/**
 * Etapa 1: la definición del producto que la IA arma conversando. El chat y las preguntas
 * están en el panel lateral; aquí se lee y se corrige el borrador por secciones.
 */
export function DefinitionStage({ artifact, editable, onChange }: StageComponentProps<Def>) {
  const a: Def = {
    problem: artifact.problem ?? { statement: "", context: "", expectedImprovement: "" },
    userTypes: artifact.userTypes ?? [],
    expectedOutcomes: artifact.expectedOutcomes ?? [],
    mvp: { included: artifact.mvp?.included ?? [], excluded: artifact.mvp?.excluded ?? [] },
    mainJourney: artifact.mainJourney ?? [],
    requirements: artifact.requirements ?? [],
    businessRules: artifact.businessRules ?? [],
    constraints: artifact.constraints ?? [],
    integrations: artifact.integrations ?? [],
    security: artifact.security ?? [],
    edgeCases: artifact.edgeCases ?? [],
  };
  const set = (patch: Partial<Def>) => onChange({ ...a, ...patch });
  const roles = new Map(a.userTypes.map((r) => [r.id, r.name]));
  const features = new Map(a.mvp.included.map((f) => [f.id, f.title]));

  return (
    <div className="def stack">
      <Section title="Problema">
        <dl className="def-problem">
          <Text label="Problema" editable={editable} value={a.problem.statement} rows={3}
            onChange={(v) => set({ problem: { ...a.problem, statement: v } })} />
          <Text label="Contexto" editable={editable} value={a.problem.context} rows={3}
            onChange={(v) => set({ problem: { ...a.problem, context: v } })} />
          <Text label="Mejora esperada" editable={editable} value={a.problem.expectedImprovement} rows={2}
            onChange={(v) => set({ problem: { ...a.problem, expectedImprovement: v } })} />
        </dl>
      </Section>

      <Section title="Usuarios y roles" count={a.userTypes.length}>
        <ul className="def-cards">
          {a.userTypes.map((r, i) => (
            <li key={r.id} className="def-card">
              <p className="def-card-head">
                <span className="chip">{r.id}</span>
                {editable
                  ? (
                    <input aria-label={`Nombre de ${r.id}`} value={r.name}
                      onChange={(e) => set({ userTypes: replace(a.userTypes, i, { ...r, name: e.target.value }) })} />
                  )
                  : <strong>{r.name}</strong>}
              </p>
              {editable
                ? (
                  <textarea aria-label={`Descripción de ${r.id}`} rows={3} value={r.description}
                    onChange={(e) => set({ userTypes: replace(a.userTypes, i, { ...r, description: e.target.value }) })} />
                )
                : <p>{r.description}</p>}
              {r.goals.length > 0 && (
                <ul className="def-goals small">{r.goals.map((g, j) => <li key={j}>{g}</li>)}</ul>
              )}
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Resultados esperados" count={a.expectedOutcomes.length}>
        <TextList items={a.expectedOutcomes} editable={editable} label="Resultado"
          onChange={(v) => set({ expectedOutcomes: v })} />
      </Section>

      <Section title="Alcance del MVP" count={a.mvp.included.length}>
        <div className="def-scope">
          <div>
            <h4>Incluido</h4>
            <ul className="def-list">
              {a.mvp.included.map((f, i) => (
                <li key={f.id}>
                  <span className="chip">{f.id}</span>{" "}
                  {editable
                    ? (
                      <span className="def-edit">
                        <input aria-label={`Título de ${f.id}`} value={f.title}
                          onChange={(e) => set({ mvp: { ...a.mvp, included: replace(a.mvp.included, i, { ...f, title: e.target.value }) } })} />
                        <textarea aria-label={`Descripción de ${f.id}`} rows={2} value={f.description}
                          onChange={(e) => set({ mvp: { ...a.mvp, included: replace(a.mvp.included, i, { ...f, description: e.target.value }) } })} />
                      </span>
                    )
                    : <><strong>{f.title}.</strong> {f.description}</>}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h4>Fuera de alcance</h4>
            <ul className="def-list">
              {a.mvp.excluded.map((x, i) => (
                <li key={i}>
                  {editable
                    ? (
                      <span className="def-edit">
                        <input aria-label="Funcionalidad excluida" value={x.title}
                          onChange={(e) => set({ mvp: { ...a.mvp, excluded: replace(a.mvp.excluded, i, { ...x, title: e.target.value }) } })} />
                        <input aria-label={`Motivo de excluir ${x.title}`} value={x.reason}
                          onChange={(e) => set({ mvp: { ...a.mvp, excluded: replace(a.mvp.excluded, i, { ...x, reason: e.target.value }) } })} />
                        <button type="button" className="link danger"
                          onClick={() => set({ mvp: { ...a.mvp, excluded: remove(a.mvp.excluded, i) } })}>Quitar</button>
                      </span>
                    )
                    : <><strong>{x.title}.</strong> <span className="muted">{x.reason}</span></>}
                </li>
              ))}
            </ul>
            {editable && (
              <button type="button" className="link"
                onClick={() => set({ mvp: { ...a.mvp, excluded: [...a.mvp.excluded, { title: "", reason: "" }] } })}>
                + Agregar exclusión
              </button>
            )}
          </div>
        </div>
      </Section>

      <Section title="Recorrido principal" count={a.mainJourney.length}>
        <ol className="def-journey">
          {[...a.mainJourney].sort((x, y) => x.step - y.step).map((s) => (
            <li key={s.step}>
              <span className="chip">{roles.get(s.actorRoleId) ?? s.actorRoleId}</span>{" "}
              {s.action} <span className="muted">→ {s.result}</span>
            </li>
          ))}
        </ol>
      </Section>

      <Section title="Requisitos funcionales" count={a.requirements.length}>
        <div className="table-scroll">
          <table className="table def-table">
            <thead>
              <tr>
                <th scope="col">Id</th>
                <th scope="col">Requisito</th>
                <th scope="col">Funcionalidad</th>
                <th scope="col">Roles</th>
                {editable && <th scope="col"><span className="sr-only">Acciones</span></th>}
              </tr>
            </thead>
            <tbody>
              {a.requirements.map((r, i) => (
                <tr key={r.id}>
                  <td><span className="chip">{r.id}</span></td>
                  <td>
                    {editable
                      ? (
                        <textarea aria-label={`Descripción de ${r.id}`} rows={2} value={r.description}
                          onChange={(e) => set({ requirements: replace(a.requirements, i, { ...r, description: e.target.value }) })} />
                      )
                      : r.description}
                  </td>
                  <td>
                    {editable
                      ? (
                        <select aria-label={`Funcionalidad de ${r.id}`} value={r.featureId}
                          onChange={(e) => set({ requirements: replace(a.requirements, i, { ...r, featureId: e.target.value }) })}>
                          {a.mvp.included.map((f) => <option key={f.id} value={f.id}>{f.id} · {f.title}</option>)}
                        </select>
                      )
                      : <span title={features.get(r.featureId)}>{r.featureId}</span>}
                  </td>
                  <td>
                    {editable
                      ? (
                        <span className="def-roles">
                          {a.userTypes.map((role) => (
                            <label key={role.id} className="def-check">
                              <input type="checkbox" checked={r.roleIds.includes(role.id)}
                                onChange={(e) => set({
                                  requirements: replace(a.requirements, i, {
                                    ...r,
                                    roleIds: e.target.checked
                                      ? [...r.roleIds, role.id]
                                      : r.roleIds.filter((x) => x !== role.id),
                                  }),
                                })} />
                              {role.name}
                            </label>
                          ))}
                        </span>
                      )
                      : (
                        <span className="chips">
                          {r.roleIds.map((id) => <span key={id} className="chip">{roles.get(id) ?? id}</span>)}
                        </span>
                      )}
                  </td>
                  {editable && (
                    <td>
                      <button type="button" className="link danger"
                        onClick={() => set({ requirements: remove(a.requirements, i) })}>Quitar</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {editable && a.mvp.included.length > 0 && (
          <button type="button" className="link"
            onClick={() => set({
              requirements: [...a.requirements, {
                id: nextId("REQ", a.requirements.map((r) => r.id)),
                description: "",
                featureId: a.mvp.included[0].id,
                roleIds: [],
              }],
            })}>
            + Agregar requisito
          </button>
        )}
      </Section>

      <Section title="Reglas de negocio" count={a.businessRules.length}>
        <ul className="def-list">
          {a.businessRules.map((r, i) => (
            <li key={r.id}>
              <span className="chip">{r.id}</span>{" "}
              {editable
                ? (
                  <span className="def-edit">
                    <textarea aria-label={`Regla ${r.id}`} rows={2} value={r.rule}
                      onChange={(e) => set({ businessRules: replace(a.businessRules, i, { ...r, rule: e.target.value }) })} />
                    <button type="button" className="link danger"
                      onClick={() => set({ businessRules: remove(a.businessRules, i) })}>Quitar</button>
                  </span>
                )
                : r.rule}
            </li>
          ))}
        </ul>
        {editable && (
          <button type="button" className="link"
            onClick={() => set({
              businessRules: [...a.businessRules, { id: nextId("RULE", a.businessRules.map((r) => r.id)), rule: "" }],
            })}>
            + Agregar regla
          </button>
        )}
      </Section>

      <Section title="Restricciones y seguridad" count={a.constraints.length + a.security.length}>
        <div className="def-scope">
          <div>
            <h4>Restricciones</h4>
            <TextList items={a.constraints} editable={editable} label="Restricción"
              onChange={(v) => set({ constraints: v })} />
          </div>
          <div>
            <h4>Seguridad</h4>
            <TextList items={a.security} editable={editable} label="Medida de seguridad"
              onChange={(v) => set({ security: v })} />
          </div>
        </div>
      </Section>

      {a.integrations.length > 0 && (
        <Section title="Integraciones externas" count={a.integrations.length}>
          <ul className="def-list">
            {a.integrations.map((x, i) => (
              <li key={i}>
                <strong>{x.name}.</strong> {x.purpose}{" "}
                <span className="muted">Si falla: {x.onFailure}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Casos borde" count={a.edgeCases.length}>
        <div className="table-scroll">
          <table className="table def-table">
            <thead>
              <tr>
                <th scope="col">Situación</th>
                <th scope="col">Comportamiento esperado</th>
                {editable && <th scope="col"><span className="sr-only">Acciones</span></th>}
              </tr>
            </thead>
            <tbody>
              {a.edgeCases.map((c, i) => (
                <tr key={i}>
                  <td>
                    {editable
                      ? (
                        <textarea aria-label="Situación" rows={2} value={c.situation}
                          onChange={(e) => set({ edgeCases: replace(a.edgeCases, i, { ...c, situation: e.target.value }) })} />
                      )
                      : c.situation}
                  </td>
                  <td>
                    {editable
                      ? (
                        <textarea aria-label={`Comportamiento ante: ${c.situation}`} rows={2} value={c.expectedBehavior}
                          onChange={(e) => set({ edgeCases: replace(a.edgeCases, i, { ...c, expectedBehavior: e.target.value }) })} />
                      )
                      : c.expectedBehavior}
                  </td>
                  {editable && (
                    <td>
                      <button type="button" className="link danger"
                        onClick={() => set({ edgeCases: remove(a.edgeCases, i) })}>Quitar</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {editable && (
          <button type="button" className="link"
            onClick={() => set({ edgeCases: [...a.edgeCases, { situation: "", expectedBehavior: "" }] })}>
            + Agregar caso borde
          </button>
        )}
      </Section>

      {editable && (
        <p className="muted small">
          Los roles, las funcionalidades y el recorrido se cambian conversando con la IA o con
          “Editar como JSON”, porque las etapas siguientes dependen de sus ids.
        </p>
      )}
    </div>
  );
}

function Section({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  return (
    <section className="def-section">
      <h3>
        {title}
        {count !== undefined && <span className="muted small"> · {count}</span>}
      </h3>
      {children}
    </section>
  );
}

function Text(
  { label, value, editable, rows, onChange }: {
    label: string;
    value: string;
    editable: boolean;
    rows: number;
    onChange: (v: string) => void;
  },
) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>
        {editable
          ? <textarea aria-label={label} rows={rows} value={value} onChange={(e) => onChange(e.target.value)} />
          : value || <span className="muted">Sin definir.</span>}
      </dd>
    </div>
  );
}

function TextList(
  { items, editable, label, onChange }: {
    items: string[];
    editable: boolean;
    label: string;
    onChange: (v: string[]) => void;
  },
) {
  if (!editable) {
    return items.length
      ? <ul className="def-list">{items.map((t, i) => <li key={i}>{t}</li>)}</ul>
      : <p className="muted">Sin elementos.</p>;
  }
  return (
    <>
      <ul className="def-list">
        {items.map((t, i) => (
          <li key={i} className="def-edit">
            <textarea aria-label={`${label} ${i + 1}`} rows={2} value={t}
              onChange={(e) => onChange(replace(items, i, e.target.value))} />
            <button type="button" className="link danger" onClick={() => onChange(remove(items, i))}>Quitar</button>
          </li>
        ))}
      </ul>
      <button type="button" className="link" onClick={() => onChange([...items, ""])}>+ Agregar</button>
    </>
  );
}

function replace<T>(list: T[], i: number, value: T): T[] {
  return list.map((x, j) => (j === i ? value : x));
}

function remove<T>(list: T[], i: number): T[] {
  return list.filter((_, j) => j !== i);
}

export default DefinitionStage;
