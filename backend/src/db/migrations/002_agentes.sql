-- Agentes de IA: hallazgos del Auditor semántico y vistas previas del Diseñador visual.

-- Origen de cada inconsistencia: el validador en código o el Auditor semántico (IA).
-- La sincronización del validador solo toca las suyas; las del auditor se cierran a mano o
-- con el Resolvedor.
ALTER TABLE inconsistencies
  ADD COLUMN source text NOT NULL DEFAULT 'validator' CHECK (source IN ('validator', 'auditor'));

-- Última vista previa de cada pantalla. El HTML ya pasó el validador de HTML seguro y además
-- se muestra en un iframe aislado (sin scripts).
CREATE TABLE screen_previews (
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  screen_id  text NOT NULL,
  html       text NOT NULL CHECK (char_length(html) <= 40000),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, screen_id)
);
