import { useEffect, useState } from "react";
import type { StageComponentProps } from "../types";

/**
 * Vista por defecto mientras una etapa no tiene su componente propio: muestra el JSON del
 * artefacto y, si se puede editar, lo deja modificar validando que sea JSON.
 */
export function JsonView({ artifact, editable, onChange }: StageComponentProps) {
  const pretty = JSON.stringify(artifact, null, 2);
  const [text, setText] = useState(pretty);
  const [invalid, setInvalid] = useState(false);

  // Si el artefacto cambia desde afuera (recarga, IA), se refleja en el editor.
  useEffect(() => {
    setText(pretty);
    setInvalid(false);
  }, [pretty]);

  if (!editable) {
    return <pre className="json">{pretty}</pre>;
  }

  return (
    <div className="stack">
      <textarea
        className="json"
        spellCheck={false}
        rows={Math.min(30, Math.max(10, text.split("\n").length + 1))}
        value={text}
        aria-invalid={invalid}
        aria-label="Contenido de la etapa en JSON"
        onChange={(e) => {
          setText(e.target.value);
          try {
            const parsed = JSON.parse(e.target.value);
            if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
              throw new Error();
            }
            setInvalid(false);
            onChange(parsed);
          } catch {
            setInvalid(true);
          }
        }}
      />
      {invalid && <p className="field-error">El JSON no es válido; no se guardará hasta corregirlo.</p>}
    </div>
  );
}
