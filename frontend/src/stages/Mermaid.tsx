import { useEffect, useId, useRef, useState } from "react";

/**
 * Dibuja un diagrama Mermaid interactivo: se puede acercar/alejar (botones o Ctrl + rueda),
 * arrastrar para moverse y, si se pasa `targets`, hacer clic en un nodo para saltar a su
 * detalle más abajo en la página. La librería se carga solo cuando se usa.
 *
 * `targets` relaciona el id del nodo en Mermaid (ya saneado) con el id del elemento HTML al
 * que se salta.
 */
export function Mermaid(
  { code, label, targets }: { code: string; label: string; targets?: Map<string, string> },
) {
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; vx: number; vy: number; moved: boolean } | null>(null);
  const zoom = (factor: number) =>
    setView((v) => ({ ...v, scale: Math.min(4, Math.max(0.4, v.scale * factor)) }));
  const id = `m${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: "base",
          fontFamily: "Schibsted Grotesk, system-ui, sans-serif",
          themeVariables: {
            darkMode: true,
            background: "#0d131b",
            primaryColor: "#111821",
            primaryBorderColor: "#5ee7ff",
            primaryTextColor: "#e6edf5",
            secondaryColor: "#17202c",
            tertiaryColor: "#0d131b",
            lineColor: "#8a97a8",
            textColor: "#e6edf5",
            edgeLabelBackground: "#0a0e13",
            mainBkg: "#111821",
            nodeBorder: "#5ee7ff",
            attributeBackgroundColorOdd: "#0f151d",
            attributeBackgroundColorEven: "#131b25",
            fontSize: "14px",
          },
        });
        const out = await mermaid.render(id, code);
        if (alive) {
          setSvg(out.svg);
          setError(null);
        }
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      alive = false;
    };
  }, [code, id]);

  if (error) {
    return (
      <div className="mermaid-error">
        <p className="field-error">No se pudo dibujar el diagrama.</p>
        <pre className="json">{code}</pre>
      </div>
    );
  }
  if (!svg) return <p className="muted">Dibujando diagrama…</p>;

  /** Busca el nodo clicado y su destino: los ids de Mermaid son "flowchart-SCR_1-0" o "entity-users-<uuid>". */
  const targetOf = (el: EventTarget | null): string | undefined => {
    if (!targets) return;
    const g = (el as Element | null)?.closest?.("g.node, g[id*='entity-']");
    const m = g?.id.match(/(?:flowchart|entity)-(.+?)-(?:\d+|[0-9a-f]{8}-[0-9a-f-]{27})$/);
    return m ? targets.get(m[1]) : undefined;
  };

  const jump = (target: string) => {
    const el = document.getElementById(target);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.remove("flash");
    void (el as HTMLElement).offsetWidth;
    el.classList.add("flash");
  };

  return (
    <figure className="mermaid is-interactive" aria-label={label}>
      <div className="mermaid-tools" role="toolbar" aria-label={`Controles de ${label}`}>
        <button type="button" className="ghost" onClick={() => zoom(1.25)} aria-label="Acercar">+</button>
        <button type="button" className="ghost" onClick={() => zoom(0.8)} aria-label="Alejar">−</button>
        <button type="button" className="ghost" onClick={() => setView({ scale: 1, x: 0, y: 0 })}>
          Centrar
        </button>
        <span className="muted small">
          {Math.round(view.scale * 100)}% · arrastra para moverte{targets ? " · clic en un nodo para ver su detalle" : ""}
        </span>
      </div>
      <div
        className="mermaid-viewport"
        onWheel={(e) => {
          if (!e.ctrlKey && !e.metaKey) return;
          e.preventDefault();
          zoom(e.deltaY < 0 ? 1.1 : 0.9);
        }}
        onPointerDown={(e) => {
          drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          const dx = e.clientX - d.x, dy = e.clientY - d.y;
          if (!d.moved && Math.hypot(dx, dy) < 4) return;
          if (!d.moved) (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          d.moved = true;
          setView((v) => ({ ...v, x: d.vx + dx, y: d.vy + dy }));
        }}
        onPointerUp={(e) => {
          const d = drag.current;
          drag.current = null;
          if (d && !d.moved) {
            const t = targetOf(e.target);
            if (t) jump(t);
          }
        }}
        onPointerCancel={() => (drag.current = null)}
      >
        <div
          className="mermaid-canvas"
          role="img"
          aria-label={label}
          style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      </div>
    </figure>
  );
}
