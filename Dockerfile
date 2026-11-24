# Imagen de producción (Google Cloud Run): un solo contenedor sirve la página y la API.
# El docker-compose.yml de desarrollo NO usa este archivo.

# 1) Compila el frontend
FROM node:22-alpine AS frontend
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# 2) Backend en Deno + el frontend compilado
FROM denoland/deno:2.9.6
WORKDIR /app
RUN chown deno:deno /app
USER deno
COPY --chown=deno:deno backend/deno.json backend/deno.lock* ./
COPY --chown=deno:deno backend/src ./src
RUN deno cache src/main.ts src/db/migrate.ts
COPY --chown=deno:deno --from=frontend /web/dist ./public

ENV APP_ENV=production \
    STATIC_DIR=/app/public \
    PORT=8080
EXPOSE 8080
# Aplica las migraciones pendientes y arranca. --allow-write solo sobre /cloudsql: es la
# carpeta del socket de Cloud SQL (Deno pide permiso de escritura para conectarse a un socket).
CMD ["sh", "-c", "deno run --allow-net --allow-env --allow-read --allow-write=/cloudsql src/db/migrate.ts && exec deno run --allow-net --allow-env --allow-read --allow-write=/cloudsql src/main.ts"]
