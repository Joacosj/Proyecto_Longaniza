#!/usr/bin/env bash
# Despliega Ideator en Google Cloud: Cloud Run (app) + Cloud SQL (PostgreSQL) + Secret Manager.
# La IA (Vertex / Agent Platform) se cobra en OTRO proyecto (PROYECTO_IA).
#
# Uso, desde Cloud Shell y en la raíz del repositorio:
#   PROYECTO_APP=<id-del-proyecto-del-compañero> bash deploy/desplegar-gcp.sh
#
# Variables opcionales:
#   PROYECTO_IA   proyecto que paga la IA (por defecto proyeco-longaniza)
#   CLAVE_IA      ruta a la clave JSON de la cuenta de servicio de PROYECTO_IA. Se guarda en
#                 Secret Manager y en los despliegues siguientes ya no hace falta pasarla. Si
#                 nunca se pasa, la app usa su propia identidad y necesita el rol en PROYECTO_IA.
#   REGION        por defecto southamerica-west1 (Santiago)
#   LLM_MODEL     por defecto google/gemini-3.5-flash
#
# Inicio de sesión con Google (opcional): si existen los secretos ideator-google-client-id e
# ideator-google-client-secret, se configuran solos (ver docs/despliegue-gcp.md).
#
# Se puede correr de nuevo sin problema: lo que ya existe se reutiliza y solo se vuelve a
# desplegar el código. Guía completa: docs/despliegue-gcp.md
set -euo pipefail

PROYECTO_APP="${PROYECTO_APP:?Define PROYECTO_APP con el id del proyecto donde va la app}"
PROYECTO_IA="${PROYECTO_IA:-proyeco-longaniza}"
REGION="${REGION:-southamerica-west1}"
LLM_MODEL="${LLM_MODEL:-google/gemini-3.5-flash}"
CLAVE_IA="${CLAVE_IA:-}"
SERVICIO="ideator"
INSTANCIA="ideator-db"
BASE="ideator"
USUARIO_DB="ideator"
SA_NOMBRE="ideator-run"
SA="${SA_NOMBRE}@${PROYECTO_APP}.iam.gserviceaccount.com"
RAIZ="$(cd "$(dirname "$0")/.." && pwd)"

paso() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
existe_secreto() { gcloud secrets describe "$1" --project "$PROYECTO_APP" >/dev/null 2>&1; }
# El secreto existe y tiene al menos una versión con valor (si no, Cloud Run no despliega).
tiene_valor() {
  [[ -n "$(gcloud secrets versions list "$1" --project "$PROYECTO_APP" --filter='state=ENABLED' \
    --limit=1 --format='value(name)' 2>/dev/null)" ]]
}
crear_secreto() { # nombre, contenido por stdin
  gcloud secrets create "$1" --project "$PROYECTO_APP" --replication-policy=automatic \
    --data-file=- >/dev/null
}

if [[ -n "$CLAVE_IA" && ! -f "$CLAVE_IA" ]]; then
  echo "No existe el archivo CLAVE_IA=$CLAVE_IA" >&2
  exit 1
fi

paso "Proyecto de la app: $PROYECTO_APP · IA cobrada en: $PROYECTO_IA · región: $REGION"
gcloud config set project "$PROYECTO_APP" >/dev/null

paso "Habilitando APIs (Cloud Run, Cloud SQL, Cloud Build, Artifact Registry, Secret Manager)"
gcloud services enable run.googleapis.com sqladmin.googleapis.com cloudbuild.googleapis.com \
  artifactregistry.googleapis.com secretmanager.googleapis.com

paso "Base de datos Cloud SQL ($INSTANCIA, PostgreSQL 16, la más chica)"
if ! gcloud sql instances describe "$INSTANCIA" >/dev/null 2>&1; then
  echo "Creando la instancia: tarda entre 5 y 15 minutos…"
  gcloud sql instances create "$INSTANCIA" --database-version=POSTGRES_16 \
    --edition=ENTERPRISE --tier=db-f1-micro --region="$REGION" \
    --storage-type=HDD --storage-size=10 --availability-type=zonal --no-backup
else
  echo "Ya existe; se reutiliza."
fi
CONEXION="$(gcloud sql instances describe "$INSTANCIA" --format='value(connectionName)')"
gcloud sql databases describe "$BASE" --instance "$INSTANCIA" >/dev/null 2>&1 ||
  gcloud sql databases create "$BASE" --instance "$INSTANCIA"

paso "Secretos (contraseña de la base y secreto de sesiones)"
if ! existe_secreto ideator-database-url; then
  CLAVE_DB="$(openssl rand -hex 24)"
  if gcloud sql users list --instance "$INSTANCIA" --format='value(name)' | grep -qx "$USUARIO_DB"; then
    gcloud sql users set-password "$USUARIO_DB" --instance "$INSTANCIA" --password "$CLAVE_DB"
  else
    gcloud sql users create "$USUARIO_DB" --instance "$INSTANCIA" --password "$CLAVE_DB"
  fi
  # El host se ignora: la app se conecta por el socket de Cloud SQL (DB_SOCKET_DIR).
  printf 'postgres://%s:%s@localhost/%s' "$USUARIO_DB" "$CLAVE_DB" "$BASE" |
    crear_secreto ideator-database-url
  unset CLAVE_DB
fi
existe_secreto ideator-session-secret || openssl rand -hex 32 | tr -d '\n' | crear_secreto ideator-session-secret

SECRETOS="DATABASE_URL=ideator-database-url:latest,SESSION_SECRET=ideator-session-secret:latest"
VARS="APP_ENV=production,GCP_PROJECT_ID=${PROYECTO_IA},GCP_LOCATION=global,LLM_MODEL=${LLM_MODEL}"
VARS="${VARS},LLM_TIMEOUT_MS=600000,DB_SOCKET_DIR=/cloudsql/${CONEXION}"
if [[ -n "$CLAVE_IA" ]]; then
  paso "Guardando la clave de la IA en Secret Manager (no queda en la imagen ni en el repo)"
  if existe_secreto ideator-gcp-key; then
    gcloud secrets versions add ideator-gcp-key --data-file="$CLAVE_IA" >/dev/null
  else
    crear_secreto ideator-gcp-key <"$CLAVE_IA"
  fi
fi
# Inicio de sesión con Google, si sus credenciales están guardadas.
if tiene_valor ideator-google-client-id && tiene_valor ideator-google-client-secret; then
  echo "Inicio de sesión con Google: activado."
  SECRETOS="${SECRETOS},GOOGLE_CLIENT_ID=ideator-google-client-id:latest"
  SECRETOS="${SECRETOS},GOOGLE_CLIENT_SECRET=ideator-google-client-secret:latest"
else
  echo "Inicio de sesión con Google: desactivado (falta guardar el valor de sus secretos)."
fi
# Si la clave ya está guardada (de un despliegue anterior), se sigue usando.
USA_CLAVE=""
if tiene_valor ideator-gcp-key; then
  USA_CLAVE=1
  SECRETOS="${SECRETOS},/secrets/gcp-key.json=ideator-gcp-key:latest"
  VARS="${VARS},GOOGLE_APPLICATION_CREDENTIALS=/secrets/gcp-key.json"
fi

paso "Cuenta de servicio de la app ($SA) y sus permisos"
gcloud iam service-accounts describe "$SA" >/dev/null 2>&1 ||
  gcloud iam service-accounts create "$SA_NOMBRE" --display-name "Ideator (Cloud Run)"
for ROL in roles/cloudsql.client roles/secretmanager.secretAccessor; do
  gcloud projects add-iam-policy-binding "$PROYECTO_APP" --member "serviceAccount:$SA" \
    --role "$ROL" --condition=None >/dev/null
done
# Cloud Build compila la imagen con la cuenta de servicio de Compute por defecto.
NUMERO="$(gcloud projects describe "$PROYECTO_APP" --format='value(projectNumber)')"
gcloud projects add-iam-policy-binding "$PROYECTO_APP" \
  --member "serviceAccount:${NUMERO}-compute@developer.gserviceaccount.com" \
  --role roles/run.builder --condition=None >/dev/null 2>&1 || true

if [[ -z "$USA_CLAVE" ]]; then
  paso "IA sin clave: la app usa su identidad ($SA) en $PROYECTO_IA"
  if gcloud projects add-iam-policy-binding "$PROYECTO_IA" --member "serviceAccount:$SA" \
    --role roles/aiplatform.user --condition=None >/dev/null 2>&1; then
    echo "Rol 'Usuario de Agent Platform' asignado en $PROYECTO_IA."
  else
    echo "No tienes permisos en $PROYECTO_IA. El dueño de ese proyecto debe correr:"
    echo "  gcloud projects add-iam-policy-binding $PROYECTO_IA --member serviceAccount:$SA --role roles/aiplatform.user"
  fi
fi

paso "Compilando y desplegando en Cloud Run (la primera vez tarda unos minutos)"
# --max-instances 1: el estado en vivo de los agentes y los límites por IP están en memoria.
# --no-cpu-throttling: la IA puede seguir trabajando aunque el navegador se desconecte.
# --timeout 900: generar una etapa puede tardar varios minutos.
gcloud run deploy "$SERVICIO" --source "$RAIZ" --region "$REGION" \
  --service-account "$SA" --add-cloudsql-instances "$CONEXION" \
  --allow-unauthenticated --port 8080 --timeout 900 --cpu 1 --memory 512Mi \
  --min-instances 0 --max-instances 1 --no-cpu-throttling \
  --set-env-vars "$VARS" --set-secrets "$SECRETOS" --quiet

URL="$(gcloud run services describe "$SERVICIO" --region "$REGION" --format='value(status.url)')"
gcloud run services update "$SERVICIO" --region "$REGION" --update-env-vars "APP_URL=${URL}" >/dev/null

paso "Comprobando"
curl -fsS "${URL}/api/health" && echo
echo
echo "Listo: ${URL}"
echo "Para el inicio con Google, la URI de redireccionamiento autorizada del cliente OAuth es:"
echo "  ${URL}/api/auth/sso/google/callback"
echo "Registros: gcloud run services logs read $SERVICIO --region $REGION --limit 50"
