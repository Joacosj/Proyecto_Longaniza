# Ideator

Proyecto semestral de Programación Profesional (TICS420). Ideator guía a una persona o equipo
desde una idea informal hasta una especificación técnica que otra IA puede implementar sin
hacer preguntas adicionales.

## Stack

| Capa | Tecnología |
|---|---|
| Backend | Deno + TypeScript + Hono |
| Base de datos | PostgreSQL 16 |
| Frontend | React + Vite + TypeScript |
| Entorno | Docker Compose |

## Cómo levantarlo

```bash
cp .env.example .env
docker compose up --build
```

- Frontend: http://localhost:5173
- Backend: http://localhost:8000/api/health
- Las migraciones se aplican solas al iniciar el backend.

### Sin Docker

```bash
# backend (requiere Deno 2 y un PostgreSQL accesible en DATABASE_URL)
cd backend
deno task migrate
deno task dev

# frontend
cd frontend
npm install
npm run dev
```

## Comandos útiles

| Comando (en `backend/`) | Qué hace |
|---|---|
| `deno task test` | Corre las pruebas |
| `deno task check` | Tipos, lint y formato |
| `deno task migrate` | Aplica migraciones pendientes |

## Estructura

```
backend/
  src/
    app.ts              registro de rutas y manejo de errores
    routes/             una carpeta o archivo por recurso
    http/errors.ts      formato único de error de la API
    contracts/          formato JSON de cada etapa (acuerdo entre épicas)
    db/migrations/      SQL versionado
  tests/
frontend/
  src/api.ts            cliente de la API
docs/
  modelo-datos.md       tablas y diagrama ER
  api-contrato.md       rutas, permisos y códigos de respuesta
  convenciones.md       ramas, commits, épicas y reparto de trabajo
```

Antes de programar, leer `docs/convenciones.md`.
