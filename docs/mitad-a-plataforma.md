# Mitad A: plataforma y colaboración

> Instrucciones autocontenidas. Si usas un asistente de IA para programar, pásale este archivo
> completo junto con `docs/api-contrato.md`, `docs/modelo-datos.md` y `docs/convenciones.md`.

## Contexto

Ideator es una aplicación web multiusuario que guía a un equipo desde una idea informal hasta
dos documentos Markdown que otra IA puede usar para implementar el producto. El proceso tiene
seis etapas en orden: `definition`, `database`, `backend`, `frontend`, `architecture`, `review`.

El proyecto está dividido en dos mitades:

- **Mitad A (esta):** usuarios, permisos, persistencia, rutas HTTP y la aplicación web que las
  usa. Es dueña de todo lo que toca la base de datos.
- **Mitad B:** el motor (IA, validaciones, generación de documentos) y los componentes que
  muestran el contenido de cada etapa. No toca la base de datos ni define rutas.

La unión entre ambas es la interfaz `Engine` en `backend/src/engine/types.ts`. Esta mitad la
**consume**. Mientras la mitad B no termine, usa `createFakeEngine()` de
`backend/src/engine/fake.ts`: `generate` devuelve las etapas de un proyecto de ejemplo completo
(reservas de salas), y `checkConsistency`, `renderDocuments` y `listArchitectures` ya son los
reales. Solo `converse` es de relleno.

## Stack y reglas

- Backend: Deno 2 + TypeScript + Hono, PostgreSQL 16 con la librería `postgres`.
- Frontend: React + Vite + TypeScript. Llamar a la API solo mediante `frontend/src/api.ts`.
- Esquema de la base: `backend/src/db/migrations/001_init.sql`. Cambios nuevos van en
  `002_*.sql`, nunca editando la 001.
- Errores: lanzar `ApiError` (`backend/src/http/errors.ts`). 401 = sin sesión válida;
  403 = con sesión pero sin permiso. Un proyecto ajeno responde 403 aunque exista.
- La autorización se valida siempre en el backend.
- Rama: `epic/plataforma`. Commits `feat: IDE-<n> descripción`.

## Archivos que te pertenecen

```
backend/src/routes/          (todas las rutas excepto health)
backend/src/repositories/    (acceso a datos, crear)
backend/src/auth/            (crear)
backend/src/main.ts, app.ts  (registro de rutas e inyección del Engine)
backend/src/db/migrations/   (nuevas migraciones)
frontend/src/ (todo excepto stages/DefinitionStage.tsx y stages/DatabaseStage.tsx, de la mitad B)
```

No modifiques `backend/src/engine/` ni `backend/src/contracts/` sin acordarlo con la mitad B.

## Tareas, en orden

Cada tarea termina con pruebas que pasan (`deno task test`) y `deno task check` sin errores.

### A1. Registro, login y sesiones (5 pts)
- `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`.
- Contraseñas con hash (bcrypt o argon2 desde npm). Sesión en cookie `HttpOnly`, `SameSite=Lax`;
  en la tabla `sessions` se guarda el hash del token.
- Middleware `requireUser` que deja el usuario en el contexto de Hono o responde 401.
- **Listo cuando:** pruebas de registro duplicado (409), login inválido (401), `/me` sin cookie (401).

### A2. Proyectos y permisos (5 pts)
- `GET/POST /api/projects`, `GET/PATCH/DELETE /api/projects/:id`.
- Al crear: el creador queda `owner` en `project_members` y se crean las seis filas de `stages`
  (`definition` en `in_progress`, el resto `locked`).
- Middleware `requireProjectRole("viewer" | "editor" | "owner")` usado por todas las rutas de
  proyecto. Jerarquía: owner > editor > viewer.
- Escribir en `audit_log` cada creación, edición y eliminación.
- **Listo cuando:** un usuario no ve proyectos ajenos en el listado y recibe 403 al pedirlos por id.

### A3. Miembros e invitaciones (3 pts)
- Rutas de miembros e invitaciones según `docs/api-contrato.md`.
- No se puede quitar ni degradar al último owner (409).

### A4. Rutas de etapas, con concurrencia (5 pts)
- `GET /stages`, `GET /stages/:kind`, `PUT /stages/:kind`, `POST /stages/:kind/approve`,
  `GET /stages/:kind/versions`, `POST /stages/:kind/generate`.
- `PUT` y `approve` reciben `version`; si no coincide con la guardada, 409 con
  `details: { currentVersion, updatedBy }`. Hacerlo con `UPDATE ... WHERE version = $n`.
- Cada guardado copia el artefacto a `stage_versions` (`source: "user"` o `"ai"`).
- `approve` responde 409 si hay preguntas bloqueantes abiertas en esa etapa. Al aprobar, la
  siguiente etapa pasa a `in_progress`. Editar una etapa aprobada vuelve a `in_progress` esa y
  las posteriores.
- `generate` arma un `ProjectContext` desde la base y llama a `engine.generate()`.
- **Listo cuando:** hay una prueba con dos guardados concurrentes donde el segundo recibe 409.

### A5. Diálogo, preguntas, revisión y documentos (5 pts)
- `GET/POST /messages`, `GET/PATCH /questions`, `GET /review`, `POST /consistency-check`,
  `PATCH /inconsistencies/:id`, `GET/POST /documents`, `GET /documents/:kind`, `GET /architectures`.
- Todas delegan la lógica al `Engine` y guardan sus resultados en las tablas correspondientes.
- `POST /documents` responde 409 con la lista de pendientes si hay etapas sin aprobar,
  bloqueantes abiertas o inconsistencias `critical`.

### A6. Aplicación web (8 pts)
- Pantallas: login/registro, lista de proyectos, crear proyecto, vista de proyecto con las seis
  etapas como pasos, miembros e invitaciones, revisión final con descarga de los dos `.md`.
- Dentro de cada etapa, montar su componente de `frontend/src/stages/`. Mientras no exista,
  mostrar el JSON del artefacto.
- Ocultar acciones según el rol (un viewer no ve "Aprobar"), sin depender de eso para la seguridad.
- Si un guardado devuelve 409, avisar que otra persona modificó la etapa y recargar.

### A7. SSO con Google (3 pts)
- `GET /api/auth/sso/google/start` y `/callback` con OpenID Connect.
- Si el correo ya existe, enlazar en `user_identities`; si no, crear el usuario.

### A8. Vistas de backend, frontend y arquitectura (3 pts)
Componentes en `frontend/src/stages/` que reciben `{ artifact, editable, onChange }`, con el
formato de `backend/src/contracts/artifacts.ts`:
- `BackendStage.tsx`: tabla de endpoints (método, ruta, roles) con detalle expandible de
  entradas, respuestas y códigos.
- `FrontendStage.tsx`: mockup de baja fidelidad de cada pantalla, dibujado con cajas a partir
  de `layout`, y mapa de navegación entre pantallas (Mermaid).
- `ArchitectureStage.tsx`: las cinco opciones del catálogo, la elegida destacada, su
  justificación y las descartadas con su razón.

### A9. Pruebas funcionales (3 pts)
- Flujo completo contra una base de prueba: registrarse, crear proyecto, invitar, que el
  invitado edite, conflicto 409, intentar acceder a un proyecto ajeno (403), generar documentos.
