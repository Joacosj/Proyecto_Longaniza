# IA con Google Cloud (Vertex AI)

Ideator usa Gemini a través de **Vertex AI**, la plataforma de IA de Google Cloud. Se usa
Vertex (y no la API key de AI Studio) porque Vertex se cobra al proyecto de Google Cloud y
consume sus créditos. El backend habla con la API de Vertex compatible con OpenAI, así que el
resto del motor no cambia.

## Configuración (una vez por proyecto de Google Cloud)

1. **Facturación:** el proyecto debe estar vinculado a la cuenta de facturación que tiene los
   créditos (Facturación → Administrar cuentas de facturación).
2. **Presupuesto:** Facturación → Presupuestos y alertas → crear uno de 50 USD con alertas al
   50 % y al 90 %, para no gastar de más sin darse cuenta.
3. **Habilitar la API:** APIs y servicios → Biblioteca → "Vertex AI API" → Habilitar.
4. **Cuenta de servicio:** IAM y administración → Cuentas de servicio → Crear cuenta de servicio
   (por ejemplo `ideator-llm`) con el rol **Vertex AI User** (`roles/aiplatform.user`).
5. **Clave:** en esa cuenta de servicio → Claves → Agregar clave → Crear clave nueva → JSON.
   Guarda el archivo descargado como `secrets/gcp-key.json` en la raíz del repositorio.
   La carpeta `secrets/` está en `.gitignore`: **nunca subas la clave al repositorio ni la
   compartas por chat**. Cada integrante puede crear su propia clave.

## Variables del `.env`

```
GCP_PROJECT_ID=<ID del proyecto, no el nombre>
GCP_LOCATION=global
GOOGLE_APPLICATION_CREDENTIALS=../secrets/gcp-key.json
LLM_MODEL=google/gemini-3.5-flash
LLM_TIMEOUT_MS=600000
```

- `GOOGLE_APPLICATION_CREDENTIALS` es la ruta para los comandos `deno task` (que se ejecutan
  desde `backend/`). Docker Compose monta `secrets/` por su cuenta y no usa esta ruta.
- `LLM_REASONING_EFFORT` (opcional: `low`, `medium`, `high`) reduce el tiempo y el costo de
  cada respuesta a cambio de menos razonamiento.

## Comprobar

```
cd backend
deno task llm:ping
```

Con Docker (`docker compose up --build`), los registros del backend deben decir
`Motor: IA real (Google Cloud Vertex AI, modelo google/gemini-3.5-flash)`.

## Errores comunes

| Mensaje | Causa |
|---|---|
| `No se encontró la clave de la cuenta de servicio` | Falta `secrets/gcp-key.json` o la ruta del `.env` está mal |
| `Google Cloud rechazó el acceso` | La API de Vertex AI no está habilitada o la cuenta de servicio no tiene el rol Vertex AI User |
| `No existe el modelo … en esa región` | Nombre de modelo incorrecto o región sin ese modelo; prueba `GCP_LOCATION=global` |
| `Se alcanzó el límite de uso de la IA` | Cuota por minuto del proyecto; esperar o pedir más cuota en IAM → Cuotas |
