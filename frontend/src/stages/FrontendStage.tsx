import type { StageComponentProps } from "../types";
import type { FrontendArtifact } from "./contracts";
import { Mermaid } from "./Mermaid";

type Screen = FrontendArtifact["screens"][number];
type Block = Screen["layout"][number];

/** Texto seguro para etiquetas de Mermaid. */
const mm = (s: string) => s.replace(/["`]/g, "'").replace(/[<>]/g, "").replace(/\|/g, "/");
/** Id de nodo válido para Mermaid. */
const node = (id: string) => id.replace(/[^A-Za-z0-9_]/g, "_");

export function navigationDiagram(artifact: FrontendArtifact): string {
  const screens = artifact.screens ?? [];
  const lines = ["flowchart LR"];
  for (const s of screens) lines.push(`  ${node(s.id)}["${mm(s.name)}"]`);
  for (const n of artifact.navigation ?? []) {
    lines.push(`  ${node(n.from)} -->|"${mm(n.trigger)}"| ${node(n.to)}`);
  }
  if (artifact.entryScreenId) {
    lines.push(`  inicio(( )) --> ${node(artifact.entryScreenId)}`);
    lines.push("  style inicio fill:#1d2b3a,stroke:#1d2b3a");
    lines.push(`  style ${node(artifact.entryScreenId)} stroke-width:3px`);
  }
  return lines.join("\n");
}

/**
 * Etapa 4: mockup de baja fidelidad de cada pantalla, dibujado con cajas a partir de
 * `layout`, y el mapa de navegación entre pantallas.
 */
export function FrontendStage({ artifact, editable, onChange }: StageComponentProps<FrontendArtifact>) {
  const screens = artifact.screens ?? [];
  const names = new Map(screens.map((s) => [s.id, s.name]));

  const updateScreen = (i: number, patch: Partial<Screen>) =>
    onChange({ ...artifact, screens: screens.map((s, j) => (j === i ? { ...s, ...patch } : s)) });

  return (
    <div className="fe stack">
      <section>
        <h3>Mapa de navegación</h3>
        {screens.length === 0
          ? <p className="muted">No hay pantallas definidas.</p>
          : <Mermaid code={navigationDiagram(artifact)} label="Mapa de navegación entre pantallas" />}
        {artifact.entryScreenId && (
          <p className="muted small">
            Se entra por <strong>{names.get(artifact.entryScreenId) ?? artifact.entryScreenId}</strong>.
          </p>
        )}
      </section>

      <section className="stack">
        <h3>Pantallas</h3>
        {screens.map((s, i) => (
          <article key={s.id ?? i} className="screen" aria-labelledby={`scr-${s.id}`}>
            <header className="screen-head">
              <span className="chip">{s.id}</span>
              {editable
                ? (
                  <input
                    id={`scr-${s.id}`}
                    aria-label={`Nombre de ${s.id}`}
                    className="screen-name"
                    value={s.name}
                    onChange={(e) => updateScreen(i, { name: e.target.value })}
                  />
                )
                : <h4 id={`scr-${s.id}`}>{s.name}</h4>}
            </header>
            {editable
              ? (
                <textarea
                  aria-label={`Propósito de ${s.id}`}
                  rows={2}
                  value={s.purpose}
                  onChange={(e) => updateScreen(i, { purpose: e.target.value })}
                />
              )
              : <p>{s.purpose}</p>}
            <p className="muted small">
              Visible para {(s.visibleToRoleIds ?? []).length ? s.visibleToRoleIds.join(", ") : "todos"}
              {s.featureIds?.length ? ` · funcionalidades ${s.featureIds.join(", ")}` : ""}
            </p>

            <Mockup screen={s} names={names} />

            {s.states && (
              <dl className="states">
                <div><dt>Vacío</dt><dd>{s.states.empty}</dd></div>
                <div><dt>Cargando</dt><dd>{s.states.loading}</dd></div>
                <div><dt>Error</dt><dd>{s.states.error}</dd></div>
              </dl>
            )}
          </article>
        ))}
      </section>
    </div>
  );
}

/** Wireframe: cada región del layout es una zona de la "ventana"; cada bloque, una caja. */
function Mockup({ screen, names }: { screen: Screen; names: Map<string, string> }) {
  const layout = screen.layout ?? [];
  const by = (region: Block["region"]) => layout.filter((b) => b.region === region);
  const header = by("header");
  const sidebar = by("sidebar");
  const main = by("main");
  const footer = by("footer");
  const modal = by("modal");
  const actions = screen.actions ?? [];

  return (
    <figure className="mock" aria-label={`Boceto de ${screen.name}`}>
      <div className="mock-chrome" aria-hidden="true"><span /><span /><span /></div>
      <div className={`mock-body${sidebar.length ? " has-sidebar" : ""}`}>
        {header.length > 0 && <div className="mock-region mock-header">{header.map(renderBlock)}</div>}
        {sidebar.length > 0 && <div className="mock-region mock-sidebar">{sidebar.map(renderBlock)}</div>}
        <div className="mock-region mock-main">
          {main.map(renderBlock)}
          {actions.length > 0 && (
            <div className="mock-actions">
              {actions.map((a, i) => (
                <span key={i} className="mock-button" title={actionHint(a, names)}>
                  {a.label}
                  {a.navigatesTo && <span className="mock-to"> → {names.get(a.navigatesTo) ?? a.navigatesTo}</span>}
                </span>
              ))}
            </div>
          )}
        </div>
        {footer.length > 0 && <div className="mock-region mock-footer">{footer.map(renderBlock)}</div>}
        {modal.length > 0 && (
          <div className="mock-modal-layer">
            <div className="mock-modal">{modal.map(renderBlock)}</div>
          </div>
        )}
      </div>
    </figure>
  );
}

function actionHint(a: Screen["actions"][number], names: Map<string, string>) {
  const parts = [];
  if (a.endpointId) parts.push(`llama a ${a.endpointId}`);
  if (a.navigatesTo) parts.push(`lleva a ${names.get(a.navigatesTo) ?? a.navigatesTo}`);
  if (a.visibleToRoleIds?.length) parts.push(`solo ${a.visibleToRoleIds.join(", ")}`);
  return parts.join(" · ");
}

function renderBlock(b: Block, i: number) {
  const fields = b.fields ?? [];
  switch (b.component) {
    case "title":
      return <div key={i} className="mk mk-title">{b.label}</div>;
    case "text":
      return (
        <div key={i} className="mk mk-text">
          <span className="mk-cap">{b.label}</span>
          <span className="bar" /><span className="bar short" />
        </div>
      );
    case "nav":
      return (
        <nav key={i} className="mk mk-nav" aria-label={b.label}>
          <strong>{b.label}</strong>
          {fields.map((f) => <span key={f}>{f}</span>)}
        </nav>
      );
    case "form":
      return (
        <div key={i} className="mk mk-form">
          <span className="mk-cap">{b.label}</span>
          {fields.map((f) => (
            <span key={f} className="mk-field"><span>{f}</span><span className="mk-input" /></span>
          ))}
        </div>
      );
    case "table":
      return (
        <div key={i} className="mk mk-table">
          <span className="mk-cap">{b.label}</span>
          <div className="mk-grid" style={{ gridTemplateColumns: `repeat(${Math.max(1, fields.length)}, minmax(0, 1fr))` }}>
            {fields.map((f) => <span key={f} className="mk-th">{f}</span>)}
            {Array.from({ length: Math.max(1, fields.length) * 3 }, (_, k) => <span key={k} className="bar" />)}
          </div>
        </div>
      );
    case "list":
      return (
        <div key={i} className="mk mk-list">
          <span className="mk-cap">{b.label}</span>
          {(fields.length ? fields : ["", "", ""]).map((f, k) => (
            <span key={k} className="mk-item">{f || <span className="bar" />}</span>
          ))}
        </div>
      );
    case "card":
      return (
        <div key={i} className="mk mk-card">
          <span className="mk-cap">{b.label}</span>
          {fields.map((f) => <span key={f} className="small">{f}</span>)}
        </div>
      );
    case "button":
      return <span key={i} className="mk mock-button">{b.label}</span>;
    default:
      return <div key={i} className="mk">{b.label}</div>;
  }
}

export default FrontendStage;
