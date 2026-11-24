# Desplegar Ideator en Google Cloud

La app corre en el proyecto de un compañero (paga Cloud Run y la base de datos) y la IA se
cobra en `proyeco-longaniza` (paga Vertex / Agent Platform). Vertex cobra al proyecto que
aparece en la URL del modelo, no al proyecto donde corre la app; por eso funciona.

```
Navegador ──HTTPS──► Cloud Run "ideator" (proyecto del compañero)
                       ├─ página (React compilado) y API (/api)
                       ├─ socket ──► Cloud SQL "ideator-db" (PostgreSQL 16)
                       └─ HTTPS ───► Vertex AI en proyeco-longaniza (créditos de la IA)
```

- **Un solo servicio** sirve la página y la API: no hay CORS ni proxy.
- **Secretos en Secret Manager**: la contraseña de la base, el secreto de sesiones y (si se usa)
  la clave de la IA. Nada de eso queda en la imagen ni en el repositorio (`.gcloudignore`).
- **Migraciones automáticas**: el contenedor las aplica cada vez que arranca.

## Antes de empezar (5 minutos)

1. **El compañero** te agrega a su proyecto: Consola → IAM y administración → IAM →
   *Otorgar acceso* → tu correo → rol **Propietario** (o Editor + Administrador de IAM del
   proyecto). Así tú corres todo desde tu Cloud Shell y él no tiene que tocar nada.
2. Anota el **ID del proyecto** del compañero (aparece en el selector de proyectos, por ejemplo
   `ideator-123456`).
3. Confirma que el código a desplegar está en GitHub (la rama `main` con los PR mergeados, o la
   rama `epic/agentes`).

## Desplegar (unos 15 minutos la primera vez)

Abre **Cloud Shell** (ícono `>_` arriba a la derecha en console.cloud.google.com) y ejecuta:

```bash
git clone https://github.com/Joacosj/Proyecto_Longaniza.git
cd Proyecto_Longaniza
git checkout main          # o epic/agentes si aún no se mergea
```

Luego elige **una** de las dos formas de dar acceso a la IA:

**A) Con la clave que ya usas en local (la más segura de que funciona).** Sube tu
`secrets/gcp-key.json` a Cloud Shell con el menú ⋮ → *Subir* (queda en tu carpeta personal de
Cloud Shell, no en el repo) y corre:

```bash
PROYECTO_APP=<id-del-proyecto-del-compañero> CLAVE_IA=~/gcp-key.json bash deploy/desplegar-gcp.sh
rm ~/gcp-key.json          # ya quedó guardada en Secret Manager
```

**B) Sin archivo de clave.** La app usa su propia cuenta de servicio y el script le da el rol
*Usuario de Agent Platform* en `proyeco-longaniza` (tú eres dueño de ese proyecto):

```bash
PROYECTO_APP=<id-del-proyecto-del-compañero> bash deploy/desplegar-gcp.sh
```

Si B falla por una política de la organización ("domain restricted sharing"), usa A.

El script termina mostrando la URL, por ejemplo `https://ideator-xxxxx-tl.a.run.app`. Esa es
la que se entrega a los evaluadores. Se puede correr de nuevo cuantas veces haga falta: reutiliza
la base y los secretos, y solo vuelve a desplegar el código.

## Probar

1. Abre la URL, crea una cuenta y un proyecto (usa el de préstamos de equipos).
2. Genera la etapa 1. Si en *Agentes* ves al Entrevistador trabajando, la IA está conectada.
3. Si algo falla, mira los registros:

```bash
gcloud run services logs read ideator --region southamerica-west1 --limit 50
```

Al arrancar debe aparecer `Motor: IA real (Google Cloud Vertex AI, …)`. Si dice
`Motor: falso (…)`, el mensaje entre paréntesis indica qué variable o permiso falta.

## Actualizar después de un cambio

```bash
cd ~/Proyecto_Longaniza && git pull
PROYECTO_APP=<id-del-proyecto-del-compañero> bash deploy/desplegar-gcp.sh
```

Con la opción A la clave ya quedó guardada en Secret Manager: no hace falta volver a subirla.

## Costos y cómo apagar

| Recurso | Configuración | Costo aproximado |
|---|---|---|
| Cloud SQL | db-f1-micro, 10 GB HDD, sin respaldos | US$ 10–15 al mes, encendida o no en uso |
| Cloud Run | 1 instancia máx., se apaga sola sin visitas | centavos al día con poco uso |
| Vertex AI | se cobra en proyeco-longaniza | según tokens (ver consola de facturación) |

Los 130 créditos alcanzan de sobra para el semestre. Después de la evaluación, para no gastar:

```bash
gcloud sql instances patch ideator-db --activation-policy=NEVER   # apaga la base (se puede volver a encender con ALWAYS)
gcloud run services delete ideator --region southamerica-west1    # o borrar el servicio
```

## Opcional: llevar los proyectos que tienes en Docker

Normalmente basta con empezar de cero en la nube. Si quieres llevar lo que tienes en local:

```bash
# En tu computador, con docker compose arriba:
docker compose exec db pg_dump -U ideator --clean --if-exists --no-owner --no-acl ideator > respaldo.sql
```

Sube `respaldo.sql` a Cloud Shell y ejecuta (pide la contraseña: está en el secreto
`ideator-database-url`, entre `ideator:` y `@`):

```bash
gcloud sql connect ideator-db --user=ideator --database=ideator < respaldo.sql
```

## Variables de producción (referencia)

| Variable | Valor en Cloud Run |
|---|---|
| `APP_ENV` | `production` (cookies `Secure`, cabeceras de seguridad estrictas) |
| `STATIC_DIR` | `/app/public` (en la imagen): carpeta del frontend compilado |
| `DATABASE_URL` | secreto `ideator-database-url` |
| `DB_SOCKET_DIR` | `/cloudsql/<proyecto>:<región>:ideator-db` |
| `SESSION_SECRET` | secreto `ideator-session-secret` |
| `GCP_PROJECT_ID` | `proyeco-longaniza` (quién paga la IA) |
| `GOOGLE_APPLICATION_CREDENTIALS` | `/secrets/gcp-key.json` solo con la opción A; sin ella se usa la identidad del servicio |
| `APP_URL` | la URL del servicio (la pone el script) |

En local nada cambia: `docker compose up --build` sigue funcionando igual.
