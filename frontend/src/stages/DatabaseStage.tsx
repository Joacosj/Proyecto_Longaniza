import type { StageComponentProps } from "../types";
import type { DatabaseArtifact } from "./contracts";
import { Mermaid } from "./Mermaid";

type Db = DatabaseArtifact;
type Entity = Db["entities"][number];
type Attribute = Entity["attributes"][number];
type Relationship = Db["relationships"][number];

const CARDINALITIES: Relationship["cardinality"][] = ["1:1", "1:N", "N:M"];
const ON_DELETE: Relationship["onDelete"][] = ["cascade", "restrict", "set null"];
const ON_DELETE_TEXT: Record<Relationship["onDelete"], string> = {
  cascade: "elimina en cascada",
  restrict: "impide eliminar",
  "set null": "deja en nulo",
};
const ER_EDGE: Record<Relationship["cardinality"], string> = {
  "1:1": "||--o|",
  "1:N": "||--o{",
  "N:M": "}o--o{",
};

/** Id válido para Mermaid. */
const mid = (s: string) => s.replace(/[^A-Za-z0-9_]/g, "_") || "_";
/** Tipo simple para Mermaid: "varchar(100)" → "varchar", "uuid[]" → "uuid_array". */
const erType = (t: string) =>
  t.replace(/\[\]$/, "_array").replace(/\(.*\)/, "").replace(/[^A-Za-z0-9_]/g, "_") || "tipo";

export function erDiagram(db: Db): string {
  const entities = db.entities ?? [];
  const relationships = db.relationships ?? [];
  const fk = new Set(relationships.map((r) => `${r.from}.${r.fromColumn}`));
  const lines = ["erDiagram"];
  for (const e of entities) {
    lines.push(`  ${mid(e.name)} {`);
    for (const a of e.attributes ?? []) {
      const keys = [a.primaryKey && "PK", fk.has(`${e.name}.${a.name}`) && "FK", a.unique && !a.primaryKey && "UK"]
        .filter(Boolean).join(",");
      lines.push(`    ${erType(a.type)} ${mid(a.name)}${keys ? ` ${keys}` : ""}`);
    }
    lines.push("  }");
  }
  for (const r of relationships) {
    lines.push(`  ${mid(r.to)} ${ER_EDGE[r.cardinality] ?? "||--o{"} ${mid(r.from)} : "${r.fromColumn.replace(/"/g, "'")}"`);
  }
  return lines.join("\n");
}

/**
 * Etapa 2: diagrama entidad-relación y edición de tablas, columnas y relaciones.
 * Índices y restricciones CHECK se muestran; se editan con “Editar como JSON”.
 */
export function DatabaseStage({ artifact, editable, onChange }: StageComponentProps<Db>) {
  const entities = artifact.entities ?? [];
  const relationships = artifact.relationships ?? [];
  const set = (patch: Partial<Db>) => onChange({ ...artifact, entities, relationships, ...patch });

  const updateEntity = (i: number, patch: Partial<Entity>) =>
    set({ entities: entities.map((e, j) => (j === i ? { ...e, ...patch } : e)) });

  const renameEntity = (i: number, name: string) => {
    const old = entities[i].name;
    set({
      entities: entities.map((e, j) => (j === i ? { ...e, name } : e)),
      relationships: relationships.map((r) => ({
        ...r,
        from: r.from === old ? name : r.from,
        to: r.to === old ? name : r.to,
      })),
    });
  };

  const removeEntity = (i: number) => {
    const name = entities[i].name;
    set({
      entities: entities.filter((_, j) => j !== i),
      relationships: relationships.filter((r) => r.from !== name && r.to !== name),
    });
  };

  const addEntity = () => {
    let n = entities.length + 1;
    while (entities.some((e) => e.name === `tabla_${n}`)) n++;
    set({
      entities: [...entities, {
        name: `tabla_${n}`,
        description: "",
        supports: [],
        attributes: [{
          name: "id",
          type: "uuid",
          nullable: false,
          primaryKey: true,
          unique: true,
          default: "gen_random_uuid()",
        }],
        indexes: [],
        constraints: [],
      }],
    });
  };

  const updateRel = (i: number, patch: Partial<Relationship>) =>
    set({ relationships: relationships.map((r, j) => (j === i ? { ...r, ...patch } : r)) });

  const columnsOf = (table: string) => entities.find((e) => e.name === table)?.attributes.map((a) => a.name) ?? [];

  return (
    <div className="db stack">
      <section>
        {editable
          ? (
            <label>
              Resumen del modelo
              <textarea rows={3} value={artifact.overview ?? ""} onChange={(e) => set({ overview: e.target.value })} />
            </label>
          )
          : artifact.overview && <p>{artifact.overview}</p>}
      </section>

      <section>
        <h3>Diagrama entidad-relación</h3>
        {entities.length === 0
          ? <p className="muted">La etapa no define tablas todavía.</p>
          : <Mermaid code={erDiagram(artifact)} label="Diagrama entidad-relación del modelo de datos" />}
      </section>

      <section className="stack">
        <h3>
          Tablas <span className="muted small">· {entities.length}</span>
        </h3>
        {entities.map((e, i) => (
          <article key={i} className="db-entity">
            <header className="db-entity-head">
              {editable
                ? (
                  <input aria-label={`Nombre de la tabla ${e.name}`} className="mono db-name" value={e.name}
                    onChange={(ev) => renameEntity(i, ev.target.value)} />
                )
                : <h4 className="mono">{e.name}</h4>}
              {e.supports?.length > 0 && (
                <span className="chips">{e.supports.map((s) => <span key={s} className="chip">{s}</span>)}</span>
              )}
              {editable && (
                <button type="button" className="link danger" onClick={() => removeEntity(i)}>Quitar tabla</button>
              )}
            </header>
            {editable
              ? (
                <textarea aria-label={`Descripción de ${e.name}`} rows={2} value={e.description}
                  onChange={(ev) => updateEntity(i, { description: ev.target.value })} />
              )
              : e.description && <p>{e.description}</p>}

            <AttributeTable
              entity={e}
              editable={editable}
              onChange={(attributes) => updateEntity(i, { attributes })}
            />

            {(e.indexes?.length > 0 || e.constraints?.length > 0) && (
              <div className="db-extra small">
                {e.indexes?.length > 0 && (
                  <p>
                    <strong>Índices:</strong>{" "}
                    {e.indexes.map((x) => `${x.unique ? "único " : ""}(${x.columns.join(", ")})`).join(" · ")}
                  </p>
                )}
                {e.constraints?.length > 0 && (
                  <ul className="db-checks">{e.constraints.map((c, j) => <li key={j}><code>{c}</code></li>)}</ul>
                )}
              </div>
            )}
          </article>
        ))}
        {editable && (
          <button type="button" className="link" onClick={addEntity}>+ Agregar tabla</button>
        )}
      </section>

      <section>
        <h3>
          Relaciones <span className="muted small">· {relationships.length}</span>
        </h3>
        {relationships.length === 0
          ? <p className="muted">No hay relaciones entre tablas.</p>
          : (
            <div className="table-scroll">
              <table className="table db-table">
                <thead>
                  <tr>
                    <th scope="col">Desde (clave foránea)</th>
                    <th scope="col">Hacia</th>
                    <th scope="col">Cardinalidad</th>
                    <th scope="col">Al eliminar</th>
                    {editable && <th scope="col"><span className="sr-only">Acciones</span></th>}
                  </tr>
                </thead>
                <tbody>
                  {relationships.map((r, i) => (
                    <tr key={i}>
                      <td>
                        {editable
                          ? (
                            <span className="db-ref">
                              <TableSelect label="Tabla de origen" value={r.from} entities={entities}
                                onChange={(from) => updateRel(i, { from, fromColumn: columnsOf(from)[0] ?? "" })} />
                              <ColumnSelect label="Columna de origen" value={r.fromColumn} columns={columnsOf(r.from)}
                                onChange={(fromColumn) => updateRel(i, { fromColumn })} />
                            </span>
                          )
                          : <code>{r.from}.{r.fromColumn}</code>}
                      </td>
                      <td>
                        {editable
                          ? (
                            <span className="db-ref">
                              <TableSelect label="Tabla de destino" value={r.to} entities={entities}
                                onChange={(to) => updateRel(i, { to, toColumn: columnsOf(to)[0] ?? "" })} />
                              <ColumnSelect label="Columna de destino" value={r.toColumn} columns={columnsOf(r.to)}
                                onChange={(toColumn) => updateRel(i, { toColumn })} />
                            </span>
                          )
                          : <code>{r.to}.{r.toColumn}</code>}
                      </td>
                      <td>
                        {editable
                          ? (
                            <select aria-label="Cardinalidad" value={r.cardinality}
                              onChange={(e) => updateRel(i, { cardinality: e.target.value as Relationship["cardinality"] })}>
                              {CARDINALITIES.map((c) => <option key={c}>{c}</option>)}
                            </select>
                          )
                          : r.cardinality}
                      </td>
                      <td>
                        {editable
                          ? (
                            <select aria-label="Al eliminar" value={r.onDelete}
                              onChange={(e) => updateRel(i, { onDelete: e.target.value as Relationship["onDelete"] })}>
                              {ON_DELETE.map((o) => <option key={o} value={o}>{ON_DELETE_TEXT[o]}</option>)}
                            </select>
                          )
                          : ON_DELETE_TEXT[r.onDelete] ?? r.onDelete}
                      </td>
                      {editable && (
                        <td>
                          <button type="button" className="link danger"
                            onClick={() => set({ relationships: relationships.filter((_, j) => j !== i) })}>
                            Quitar
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        {editable && entities.length > 0 && (
          <button type="button" className="link"
            onClick={() => {
              const from = entities[0].name;
              const to = (entities[1] ?? entities[0]).name;
              set({
                relationships: [...relationships, {
                  from,
                  fromColumn: columnsOf(from)[0] ?? "",
                  to,
                  toColumn: columnsOf(to)[0] ?? "",
                  cardinality: "1:N",
                  onDelete: "restrict",
                }],
              });
            }}>
            + Agregar relación
          </button>
        )}
      </section>

      {editable && (
        <p className="muted small">
          Índices y restricciones CHECK se editan con “Editar como JSON”. Al renombrar una tabla
          se actualizan sus relaciones; revisa también los endpoints que la usan.
        </p>
      )}
    </div>
  );
}

function AttributeTable(
  { entity, editable, onChange }: { entity: Entity; editable: boolean; onChange: (a: Attribute[]) => void },
) {
  const attrs = entity.attributes ?? [];
  const update = (i: number, patch: Partial<Attribute>) =>
    onChange(attrs.map((a, j) => (j === i ? { ...a, ...patch } : a)));

  return (
    <div className="table-scroll">
      <table className="table db-table">
        <thead>
          <tr>
            <th scope="col">Columna</th>
            <th scope="col">Tipo</th>
            <th scope="col">Nulo</th>
            <th scope="col">PK</th>
            <th scope="col">Único</th>
            <th scope="col">Por defecto</th>
            {editable && <th scope="col"><span className="sr-only">Acciones</span></th>}
          </tr>
        </thead>
        <tbody>
          {attrs.map((a, i) => {
            const name = `${entity.name}.${a.name}`;
            return (
              <tr key={i} title={a.description}>
                <td>
                  {editable
                    ? <input aria-label={`Nombre de la columna ${name}`} className="mono" value={a.name}
                      onChange={(e) => update(i, { name: e.target.value })} />
                    : <code>{a.name}</code>}
                </td>
                <td>
                  {editable
                    ? <input aria-label={`Tipo de ${name}`} className="mono" value={a.type}
                      onChange={(e) => update(i, { type: e.target.value })} />
                    : <span className="mono">{a.type}</span>}
                </td>
                <td><Flag label={`${name} admite nulo`} value={a.nullable} editable={editable}
                  onChange={(v) => update(i, { nullable: v })} /></td>
                <td><Flag label={`${name} es clave primaria`} value={a.primaryKey} editable={editable}
                  onChange={(v) => update(i, { primaryKey: v, nullable: v ? false : a.nullable })} /></td>
                <td><Flag label={`${name} es único`} value={a.unique} editable={editable}
                  onChange={(v) => update(i, { unique: v })} /></td>
                <td>
                  {editable
                    ? <input aria-label={`Valor por defecto de ${name}`} className="mono" value={a.default ?? ""}
                      onChange={(e) => update(i, { default: e.target.value || undefined })} />
                    : a.default && <code>{a.default}</code>}
                </td>
                {editable && (
                  <td>
                    <button type="button" className="link danger"
                      onClick={() => onChange(attrs.filter((_, j) => j !== i))}>Quitar</button>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
      {editable && (
        <button type="button" className="link"
          onClick={() => onChange([...attrs, { name: "", type: "text", nullable: true, primaryKey: false, unique: false }])}>
          + Agregar columna
        </button>
      )}
    </div>
  );
}

function Flag(
  { label, value, editable, onChange }: { label: string; value: boolean; editable: boolean; onChange: (v: boolean) => void },
) {
  if (editable) {
    return <input type="checkbox" aria-label={label} checked={value} onChange={(e) => onChange(e.target.checked)} />;
  }
  return value ? <span aria-label={`${label}: sí`}>sí</span> : <span className="muted" aria-label={`${label}: no`}>—</span>;
}

function TableSelect(
  { label, value, entities, onChange }: { label: string; value: string; entities: Entity[]; onChange: (v: string) => void },
) {
  return (
    <select aria-label={label} className="mono" value={value} onChange={(e) => onChange(e.target.value)}>
      {!entities.some((e) => e.name === value) && <option value={value}>{value || "—"}</option>}
      {entities.map((e) => <option key={e.name} value={e.name}>{e.name}</option>)}
    </select>
  );
}

function ColumnSelect(
  { label, value, columns, onChange }: { label: string; value: string; columns: string[]; onChange: (v: string) => void },
) {
  return (
    <select aria-label={label} className="mono" value={value} onChange={(e) => onChange(e.target.value)}>
      {!columns.includes(value) && <option value={value}>{value || "—"}</option>}
      {columns.map((c) => <option key={c} value={c}>{c}</option>)}
    </select>
  );
}

export default DatabaseStage;
