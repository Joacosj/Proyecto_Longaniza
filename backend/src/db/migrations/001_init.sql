-- Modelo inicial de Longanizator. Ver docs/modelo-datos.md.

-- ---------------------------------------------------------------- Usuarios
CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL,
  name          text NOT NULL,
  password_hash text,                       -- NULL si la cuenta solo usa SSO
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_key ON users (lower(email));

-- Identidades externas (SSO). Un usuario puede tener varias.
CREATE TABLE user_identities (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider   text NOT NULL,                 -- 'google', 'microsoft', ...
  subject    text NOT NULL,                 -- identificador del usuario en el proveedor
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, subject)
);

CREATE TABLE sessions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,          -- se guarda el hash, nunca el token
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- Proyectos
CREATE TABLE projects (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  initial_idea  text NOT NULL,
  created_by    uuid NOT NULL REFERENCES users(id),
  current_stage text NOT NULL DEFAULT 'definition'
    CHECK (current_stage IN ('definition','database','backend','frontend','architecture','review')),
  status        text NOT NULL DEFAULT 'in_progress'
    CHECK (status IN ('in_progress','ready','generated')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Privado por defecto: solo quienes están aquí pueden ver o editar el proyecto.
CREATE TABLE project_members (
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       text NOT NULL CHECK (role IN ('owner','editor','viewer')),
  added_by   uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, user_id)
);
CREATE INDEX project_members_user_idx ON project_members (user_id);

CREATE TABLE invitations (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  email      text NOT NULL,
  role       text NOT NULL CHECK (role IN ('editor','viewer')),
  token_hash text NOT NULL UNIQUE,
  status     text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','accepted','revoked','expired')),
  invited_by uuid NOT NULL REFERENCES users(id),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX invitations_project_idx ON invitations (project_id);

-- ---------------------------------------------------------------- Etapas
-- Una fila por etapa y proyecto. `artifact` guarda el JSON estructurado de la etapa
-- (formatos en backend/src/contracts/artifacts.ts). `version` permite el control de
-- concurrencia optimista: un UPDATE con versión antigua debe responder 409.
CREATE TABLE stages (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind        text NOT NULL
    CHECK (kind IN ('definition','database','backend','frontend','architecture','review')),
  status      text NOT NULL DEFAULT 'locked'
    CHECK (status IN ('locked','in_progress','approved')),
  artifact    jsonb NOT NULL DEFAULT '{}'::jsonb,
  version     integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  updated_by  uuid REFERENCES users(id),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  approved_by uuid REFERENCES users(id),
  approved_at timestamptz,
  UNIQUE (project_id, kind)
);

-- Historial inmutable: cada guardado deja una copia con su autor.
CREATE TABLE stage_versions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stage_id   uuid NOT NULL REFERENCES stages(id) ON DELETE CASCADE,
  version    integer NOT NULL,
  artifact   jsonb NOT NULL,
  source     text NOT NULL CHECK (source IN ('ai','user')),
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (stage_id, version)
);

-- ---------------------------------------------------------------- Diálogo
CREATE TABLE messages (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  stage_kind text NOT NULL,
  role       text NOT NULL CHECK (role IN ('user','assistant')),
  user_id    uuid REFERENCES users(id),     -- NULL cuando habla la IA
  content    text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX messages_project_stage_idx ON messages (project_id, stage_kind, created_at);

-- Preguntas que Longanizator plantea. Una pregunta bloqueante abierta impide aprobar su etapa
-- y generar los documentos finales.
CREATE TABLE questions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  stage_kind  text NOT NULL,
  text        text NOT NULL,
  rationale   text NOT NULL,                -- por qué importa y a qué afecta
  affects     text[] NOT NULL DEFAULT '{}', -- 'database','backend','frontend','architecture'
  is_blocking boolean NOT NULL DEFAULT false,
  status      text NOT NULL DEFAULT 'open' CHECK (status IN ('open','answered','deferred')),
  answer      text,
  answered_by uuid REFERENCES users(id),
  answered_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  -- Una bloqueante no se puede posponer.
  CHECK (NOT (is_blocking AND status = 'deferred'))
);
CREATE INDEX questions_project_open_idx ON questions (project_id) WHERE status = 'open';

-- Contradicciones entre etapas detectadas por el validador de consistencia.
CREATE TABLE inconsistencies (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  stages      text[] NOT NULL,
  description text NOT NULL,
  severity    text NOT NULL CHECK (severity IN ('critical','warning')),
  status      text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  resolved_by uuid REFERENCES users(id),
  resolved_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX inconsistencies_project_open_idx ON inconsistencies (project_id) WHERE status = 'open';

-- ---------------------------------------------------------------- Arquitecturas
-- Catálogo de las cinco arquitecturas base (cuatro del curso y una del grupo).
CREATE TABLE architecture_templates (
  key         text PRIMARY KEY,
  name        text NOT NULL,
  summary     text NOT NULL,
  definition  jsonb NOT NULL,               -- persistencia, backend, frontend, infra, operación, auth
  position    integer NOT NULL DEFAULT 0
);

-- ---------------------------------------------------------------- Resultado
CREATE TABLE generated_documents (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind         text NOT NULL CHECK (kind IN ('product_spec','architecture')),
  version      integer NOT NULL,
  content      text NOT NULL,               -- Markdown autocontenido
  generated_by uuid NOT NULL REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, kind, version)
);

-- ---------------------------------------------------------------- Trazabilidad
CREATE TABLE audit_log (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id  uuid REFERENCES projects(id) ON DELETE CASCADE,
  user_id     uuid REFERENCES users(id),
  action      text NOT NULL,                -- 'stage.updated', 'member.added', ...
  entity_type text NOT NULL,
  entity_id   text,
  detail      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_project_idx ON audit_log (project_id, created_at DESC);
