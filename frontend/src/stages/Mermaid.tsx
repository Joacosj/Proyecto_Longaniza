import { useEffect, useId, useState } from "react";

/**
 * Dibuja un diagrama Mermaid. La librería se carga solo cuando se usa, para no agrandar
 * el resto de la aplicación.
 */
export function Mermaid({ code, label }: { code: string; label: string }) {
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
            primaryColor: "#fbfcfa",
            primaryBorderColor: "#1d2b3a",
            primaryTextColor: "#1d2b3a",
            lineColor: "#5b6672",
            edgeLabelBackground: "#f1f3ef",
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
  return (
    <figure className="mermaid" role="img" aria-label={label}>
      <div dangerouslySetInnerHTML={{ __html: svg }} />
    </figure>
  );
}
