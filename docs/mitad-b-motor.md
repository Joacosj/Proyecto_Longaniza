# Mitad B: motor de especificación

> Instrucciones autocontenidas. Si usas un asistente de IA para programar, pásale este archivo
> completo junto con `backend/src/contracts/artifacts.ts`, `backend/src/engine/types.ts` y
> `docs/convenciones.md`.

## Contexto

Ideator es una aplicación web multiusuario que guía a un equipo desde una idea informal hasta
dos documentos Markdown que otra IA puede usar para implementar el producto. El proceso tiene
seis etapas en orden: `definition`, `database`, `backend`, `frontend`, `architecture`, `review`.

**Cómo se evalúa:** los profesores recorren Ideator con un caso común, responden sus preguntas,
y entregan los dos Markdown a una IA externa que intenta construir el producto. Esta mitad es
la que decide esa nota: calidad de las preguntas, detección de decisiones bloqueantes,
consistencia entre etapas y precisión de los documentos. Hay que evitar dos extremos: documentos
vagos (la IA externa inventa decisiones) y documentos largos pero imprecisos.

El proyecto está dividido en dos mitades:

- **Mitad A:** usuarios, permisos, base de datos, rutas HTTP y la aplicación web.
- **Mitad B (esta):** implementa la interfaz `Engine` (`backend/src/engine/types.ts`) y los
  componentes de React que muestran y editan el contenido de cada etapa.

Esta mitad **no toca la base de datos ni define rutas HTTP**. Recibe un `ProjectContext` y
devuelve datos. Eso permite probar todo con objetos de ejemplo, sin levantar nada más.

## Stack y reglas

- Deno 2 + TypeScript para el motor; React + TypeScript para los componentes.
- El formato de cada etapa está en `backend/src/contracts/artifacts.ts`. Las referencias entre
  etapas van por id (`ROLE-1`, `FEAT-2`, `REQ-3`, nombre de tabla, `EP-4`, `SCR-1`).
- La IA siempre responde JSON validado contra ese formato. Si la respuesta no es válida, se
  reintenta una vez indicando el error; si vuelve a fallar, se lanza un error claro.
- La API key va en variables de entorno (`LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`), nunca en
  el código ni en commits.
- Ramas: `epic/revision-documentos` (B1, B2, B3, B9), `epic/diseno-tecnico` (B4, B7) y
  `epic/definicion` (B5, B6, B8). Commits `feat: IDE-<n> descripción`.

## Archivos que te pertenecen

```
backend/src/engine/         (todo, excepto acordar cambios de types.ts con la mitad A)
backend/src/contracts/      (acordar cambios con la mitad A)
backend/tests/engine/       (crear)
frontend/src/stages/DefinitionStage.tsx, DatabaseStage.tsx   (crear)
```

## Tareas, en orden

### B1. Proyecto de ejemplo completo (3 pts)
- `backend/tests/engine/fixtures/ejemplo.ts`: un `ProjectContext` con las cinco etapas llenas y
  coherentes para un producto pequeño realista (por ejemplo, reservas de salas de estudio con
  dos roles). Se usa en todas las pruebas siguientes.

### B2. Validador de consistencia (5 pts)
- `checkConsistency(context)` en `engine/consistency.ts`. Determinista, sin IA. Reglas mínimas:
  - Cada requisito apunta a una funcionalidad del MVP que existe; cada rol citado existe.
  - Cada entidad soporta al menos un requisito; cada relación apunta a entidades y columnas que existen.
  - Cada endpoint usa entidades existentes y roles existentes; los endpoints de proyecto
    documentan 401 y 403.
  - Cada acción de pantalla llama a un endpoint existente o navega a una pantalla existente;
    cada funcionalidad del MVP aparece en al menos una pantalla; no hay pantallas huérfanas.
  - La arquitectura elegida existe en el catálogo.
- **Listo cuando:** el ejemplo de B1 da cero inconsistencias, y hay una prueba por regla que
  rompe el ejemplo a propósito y verifica que se detecta.

### B3. Generador de documentos Markdown (5 pts)
- `renderDocuments(context)` en `engine/documents.ts`. Determinista, sin IA.
- `product_spec`: problema, usuarios y roles, resultados esperados, MVP incluido y excluido,
  recorrido principal, requisitos, reglas de negocio, casos borde, modelo de datos (tablas con
  columnas, tipos, claves y restricciones, más un diagrama Mermaid), cada endpoint con entradas,
  salidas y códigos, y cada pantalla con sus acciones y el mapa de navegación.
- `architecture`: arquitectura elegida y por qué, tecnologías, despliegue, variables de entorno,
  autenticación, SSO, sesión, autorización y observabilidad.
- Ambos deben entenderse sin conocer Ideator ni la conversación: nada de "como se dijo antes".
- **Listo cuando:** existe una prueba que genera los documentos del ejemplo y verifica que todas
  las tablas, endpoints y pantallas aparecen.

### B4. Catálogo de arquitecturas (3 pts)
- `engine/architectures.ts` con cinco `ArchitectureTemplate`. El profesor no ha entregado los
  cuatro escenarios oficiales, así que se usa este catálogo provisorio, fácil de reemplazar:
  1. `monolith`: monolito en contenedores con Docker Compose, NGINX y PostgreSQL en una VM.
  2. `baas`: Supabase (base, autenticación, almacenamiento) con frontend en Azure Static Web Apps.
  3. `microservices`: servicios en contenedores, NGINX como API gateway, secretos en Azure Key Vault.
  4. `realtime`: GraphQL con suscripciones por WebSockets para colaboración en vivo.
  5. `ai-agents` (propuesta del grupo): Vertex AI y Google Agent Development Kit.

### B5. Cliente de IA (3 pts) — hecho
- `engine/llm.ts`: función `completeJson(system, messages, schemaDescription)` usando
  `LLM_BASE_URL`, `LLM_API_KEY` y `LLM_MODEL`.
- El proveedor es **Microsoft Foundry** (key entregada por la universidad), con su API
  compatible con OpenAI (ruta v1, sin `api-version`):
  - `LLM_BASE_URL`: el endpoint del recurso terminado en `/openai/v1`, por ejemplo
    `https://<recurso>.openai.azure.com/openai/v1`.
  - `LLM_MODEL`: el **nombre del deployment** en Foundry (no necesariamente el nombre del modelo).
  - Llamada: `POST {LLM_BASE_URL}/chat/completions` con header `api-key: {LLM_API_KEY}` y cuerpo
    `{ "model": LLM_MODEL, "messages": [...], "response_format": { "type": "json_object" } }`.
  - Se puede usar el paquete `npm:openai` con `baseURL` y `apiKey`, o `fetch` directo.
- Manejar error de red, timeout, 429 (límite de uso: reintentar con espera), 401 (key inválida)
  y respuesta no JSON, con errores claros.
- Prueba de conexión: `deno task llm:ping` (desde `backend/`, lee el `.env` de la raíz).
- Uso: `completeJson(loadLlmConfig(), { system, messages, validate })`. `validate` recibe el
  objeto parseado y debe lanzar un Error con un mensaje claro si no cumple el formato; ese
  mensaje se le pasa a la IA para que corrija su respuesta una vez.

### B6. Etapa 1 con preguntas bloqueantes (8 pts)
- `converse()` para `definition`. El prompt debe:
  - Cubrir problema, contexto, usuarios y roles, resultados esperados, MVP dentro y fuera,
    recorrido principal, requisitos, reglas, integraciones, seguridad y casos borde.
  - Marcar como bloqueante solo lo que cambia el modelo de datos, el backend, la interfaz o la
    arquitectura (ej. si hay distintos roles, si algo es anónimo, si hay pagos). Lo demás va como
    pregunta no bloqueante.
  - No inventar respuestas ni repetir preguntas ya respondidas.
  - Devolver `artifactDraft` cuando haya información suficiente.

### B7. Generación de las etapas siguientes (8 pts)
- `generate()` para `database`, `backend`, `frontend` y `architecture`, siempre usando las
  etapas anteriores como contexto y referenciando sus ids.
- Después de generar, correr `checkConsistency` y, si hay inconsistencias, reintentar una vez
  pasándoselas a la IA.

### B8. Componentes de definición y base de datos (5 pts)
- `frontend/src/stages/DefinitionStage.tsx`: chat con la IA y lista de preguntas, con las
  bloqueantes destacadas y un campo para responderlas.
- `frontend/src/stages/DatabaseStage.tsx`: diagrama ER (Mermaid) y edición de entidades,
  atributos y relaciones.
- Ambos reciben `{ artifact, editable, onChange }`. Las vistas de backend, frontend y
  arquitectura las hace la mitad A (tarea A9).

### B9. Prueba de punta a punta (3 pts)
- Correr el caso de ejemplo completo con la IA real, pasar los dos Markdown a una IA externa,
  anotar qué decisiones tuvo que inventar y ajustar prompts o plantillas.
