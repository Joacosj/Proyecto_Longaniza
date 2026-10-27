# Contrato de la API de Ideator

Prefijo común: `/api`. Formato JSON. Sesión por cookie `HttpOnly`.

Este contrato permite que el frontend avance con datos simulados mientras el backend se
implementa. Solo `/health` está implementado; el resto indica la épica responsable.

## Errores

Todas las respuestas de error usan el mismo cuerpo:

```json
{ "error": { "code": "FORBIDDEN", "message": "No tienes acceso a este proyecto" } }
```

| Estado | Código | Cuándo |
|---|---|---|
| 400 | `BAD_REQUEST` | JSON mal formado o parámetro inválido |
| 401 | `UNAUTHENTICATED` | No hay sesión válida |
| 403 | `FORBIDDEN` | Hay sesión, pero el usuario no es miembro o su rol no alcanza |
| 404 | `NOT_FOUND` | El recurso no existe dentro de un proyecto al que sí se tiene acceso |
| 409 | `CONFLICT` | Versión desactualizada o estado que no permite la acción |
| 422 | `VALIDATION_ERROR` | Datos con formato correcto pero inválidos |
| 500 | `INTERNAL` | Error inesperado |

Un proyecto ajeno responde 403 aunque el identificador exista: conocer un id no da acceso.

## Roles dentro de un proyecto

| Acción | owner | editor | viewer |
|---|---|---|---|
| Ver proyecto, etapas, historial | Sí | Sí | Sí |
| Responder preguntas, editar y aprobar etapas | Sí | Sí | No |
| Generar documentos | Sí | Sí | No |
| Invitar, cambiar roles, eliminar proyecto | Sí | No | No |

## Salud (implementado)

| Método | Ruta | Respuesta |
|---|---|---|
| GET | `/health` | 200 |
| GET | `/health/db` | 200, o 503 si la base no responde |

## Autenticación (épica Plataforma)

| Método | Ruta | Descripción | Respuestas |
|---|---|---|---|
| POST | `/auth/register` | Crea cuenta con `email`, `name`, `password` | 201, 409, 422 |
| POST | `/auth/login` | Inicia sesión | 200, 401, 422 |
| POST | `/auth/logout` | Cierra la sesión | 204, 401 |
| GET | `/auth/me` | Usuario actual | 200, 401 |
| GET | `/auth/sso/:provider/start` | Redirige al proveedor de identidad | 302, 404 |
| GET | `/auth/sso/:provider/callback` | Recibe la respuesta y crea la sesión | 302, 400 |

## Proyectos y miembros (épica Plataforma)

| Método | Ruta | Rol mínimo | Respuestas |
|---|---|---|---|
| GET | `/projects` | autenticado (solo los propios) | 200, 401 |
| POST | `/projects` | autenticado | 201, 401, 422 |
| GET | `/projects/:id` | viewer | 200, 401, 403 |
| PATCH | `/projects/:id` | owner | 200, 401, 403, 422 |
| DELETE | `/projects/:id` | owner | 204, 401, 403 |
| GET | `/projects/:id/members` | viewer | 200, 401, 403 |
| PATCH | `/projects/:id/members/:userId` | owner | 200, 401, 403, 404, 422 |
| DELETE | `/projects/:id/members/:userId` | owner | 204, 401, 403, 404, 409 |
| POST | `/projects/:id/invitations` | owner | 201, 401, 403, 409, 422 |
| POST | `/invitations/:token/accept` | autenticado | 200, 401, 404, 409 |
| GET | `/projects/:id/audit` | viewer | 200, 401, 403 |

`POST /projects` recibe `{ "name", "initialIdea" }`, crea las seis etapas (la primera en
`in_progress`, el resto en `locked`) y deja al creador como `owner`.

## Etapas (compartido)

`:kind` es `definition`, `database`, `backend`, `frontend`, `architecture` o `review`.

| Método | Ruta | Rol mínimo | Descripción | Respuestas |
|---|---|---|---|---|
| GET | `/projects/:id/stages` | viewer | Estado de las seis etapas | 200, 401, 403 |
| GET | `/projects/:id/stages/:kind` | viewer | Artefacto, estado y versión | 200, 401, 403, 404 |
| POST | `/projects/:id/stages/:kind/generate` | editor | La IA propone el artefacto a partir de las etapas anteriores | 200, 401, 403, 409 |
| PUT | `/projects/:id/stages/:kind` | editor | Guarda una edición manual | 200, 401, 403, 409, 422 |
| POST | `/projects/:id/stages/:kind/approve` | editor | Aprueba y desbloquea la siguiente | 200, 401, 403, 409 |
| GET | `/projects/:id/stages/:kind/versions` | viewer | Historial con autor y fecha | 200, 401, 403 |

### Concurrencia

`PUT` y `approve` reciben la versión que el cliente tenía cargada:

```json
{ "version": 4, "artifact": { } }
```

Si la versión guardada ya no es 4, el backend responde 409 con la versión vigente para que la
interfaz muestre los cambios del otro usuario antes de reintentar:

```json
{ "error": { "code": "CONFLICT", "message": "Otra persona modificó esta etapa",
             "details": { "currentVersion": 5, "updatedBy": "Ana" } } }
```

`approve` también responde 409 si quedan preguntas bloqueantes abiertas en la etapa.

## Diálogo y preguntas (épica Definición y datos)

| Método | Ruta | Rol mínimo | Respuestas |
|---|---|---|---|
| GET | `/projects/:id/messages?stage=` | viewer | 200, 401, 403 |
| POST | `/projects/:id/messages` | editor | 201, 401, 403, 422 |
| GET | `/projects/:id/questions?status=&blocking=` | viewer | 200, 401, 403 |
| PATCH | `/projects/:id/questions/:questionId` | editor | 200, 401, 403, 404, 409, 422 |

`POST /messages` guarda el mensaje del usuario y devuelve la respuesta de la IA junto con las
preguntas nuevas que haya detectado. `PATCH /questions` responde o pospone una pregunta;
posponer una bloqueante responde 409.

## Arquitecturas (épica Diseño técnico)

| Método | Ruta | Rol mínimo | Respuestas |
|---|---|---|---|
| GET | `/architectures` | autenticado | 200, 401 |

## Revisión y documentos (épica Revisión y documentos)

| Método | Ruta | Rol mínimo | Descripción | Respuestas |
|---|---|---|---|---|
| GET | `/projects/:id/review` | viewer | Resumen consolidado y pendientes | 200, 401, 403 |
| POST | `/projects/:id/consistency-check` | editor | Corre el validador entre etapas | 200, 401, 403 |
| PATCH | `/projects/:id/inconsistencies/:incId` | editor | Marca una inconsistencia como resuelta | 200, 401, 403, 404 |
| POST | `/projects/:id/documents` | editor | Genera los dos Markdown | 201, 401, 403, 409 |
| GET | `/projects/:id/documents` | viewer | Lista de versiones generadas | 200, 401, 403 |
| GET | `/projects/:id/documents/:kind` | viewer | Descarga `product_spec` o `architecture` como `text/markdown` | 200, 401, 403, 404 |

`POST /documents` responde 409 con la lista de pendientes si hay etapas sin aprobar, preguntas
bloqueantes abiertas o inconsistencias críticas sin resolver.
