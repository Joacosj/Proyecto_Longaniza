/**
 * Catálogo de las cinco arquitecturas base de Longanizator.
 * Las cuatro primeras cubren los escenarios iniciales; la quinta es la propuesta del grupo.
 *
 * El catálogo describe opciones. La etapa de arquitectura debe elegir UNA y fijar
 * tecnologías concretas (ej. "Drizzle", no "Prisma o Drizzle"), para que la IA que implemente
 * el producto no tenga que decidir nada.
 */
import type { ArchitectureTemplate } from "../contracts/artifacts.ts";

export const ARCHITECTURES: readonly ArchitectureTemplate[] = [
  {
    key: "modular-monolith",
    name: "Monolito modular moderno",
    summary: "Una sola aplicación desplegable, organizada internamente en módulos por dominio. " +
      "Reduce la sobrecarga operativa al evitar la latencia de red entre servicios y las " +
      "transacciones distribuidas. Ideal cuando el modelo de negocio aún está iterando.",
    bestFor: [
      "MVP y productos en etapa temprana",
      "Equipos pequeños",
      "Dominios relacionados entre sí con transacciones que cruzan módulos",
    ],
    notRecommendedWhen: [
      "Partes del sistema necesitan escalar o desplegarse de forma independiente",
      "Varios equipos grandes trabajan en dominios separados",
    ],
    persistence: "PostgreSQL con migraciones versionadas (Prisma, Drizzle o Alembic según el " +
      "lenguaje del backend). Una sola base de datos con esquemas o prefijos por módulo.",
    backend: "Un proceso con capas (rutas, servicios, repositorios) y módulos por dominio que se " +
      "comunican mediante interfaces internas, nunca accediendo directo a tablas de otro módulo.",
    frontend:
      "Aplicación SPA (React, Vue o similar) servida como estáticos, o renderizada por el " +
      "mismo backend.",
    communication: "Llamadas internas en el mismo proceso entre módulos; REST o GraphQL hacia el " +
      "frontend.",
    infrastructure:
      "Imagen Docker optimizada con multi-stage build. Docker Compose en desarrollo; " +
      "contenedores administrados (Azure Container Apps, Oracle Cloud o similar) en staging y " +
      "producción, detrás de NGINX o del balanceador del proveedor.",
    operation: "Variables de entorno por ambiente (dev, staging, prod) y secretos en un gestor " +
      "(Azure Key Vault). Logs estructurados en JSON, endpoint /health, métricas básicas de " +
      "latencia y errores por ruta.",
    auth: "Sesión por cookie HttpOnly o JWT emitido por el propio backend; SSO mediante OpenID " +
      "Connect con un proveedor externo (Google, Microsoft Entra ID). Autorización por rol " +
      "validada en un middleware del backend en cada ruta.",
  },
  {
    key: "jamstack-baas",
    name: "Jamstack / Serverless + BaaS",
    summary: "Frontend estático conectado a servicios gestionados. Elimina el mantenimiento de " +
      "servidores: alta disponibilidad, parches de seguridad y balanceo de carga quedan a cargo " +
      "del proveedor cloud.",
    bestFor: [
      "Productos con poca lógica de negocio en el servidor",
      "Equipos sin capacidad de operar infraestructura",
      "Necesidad de tiempo real simple (listas o tableros que se actualizan solos)",
    ],
    notRecommendedWhen: [
      "Hay procesos largos o pesados en el servidor",
      "Se requiere control total sobre la base de datos o evitar dependencia del proveedor",
      "Reglas de negocio complejas que no caben en políticas de acceso o funciones cortas",
    ],
    persistence: "Base de datos gestionada (Supabase sobre PostgreSQL, o Firebase) con tiempo " +
      "real integrado.",
    backend: "Sin servidor propio permanente. La lógica de negocio sensible va en Serverless o " +
      "Edge Functions; el resto lo resuelven las políticas de acceso de la base.",
    frontend: "SPA o sitio estático (React, Next.js estático o similar) en un hosting estático " +
      "(Azure Static Web Apps, Vercel o Netlify).",
    communication: "SDK tipado del proveedor directo desde el frontend, protegido con políticas " +
      "Row Level Security (RLS); endpoints REST/JSON en funciones para integraciones externas.",
    infrastructure: "Totalmente gestionada por el proveedor: base de datos, autenticación, " +
      "almacenamiento, funciones y hosting estático.",
    operation: "Despliegue continuo desde Git con vistas previas automáticas por rama. Logs y " +
      "métricas desde el panel del proveedor; secretos en la configuración de las funciones.",
    auth: "Autenticación gestionada por el proveedor (Supabase Auth o Firebase Auth) con SSO por " +
      "OAuth/OIDC. La autorización se define con políticas RLS por fila, que deben cubrir todas " +
      "las tablas, porque el frontend accede directo a la base.",
  },
  {
    key: "microservices",
    name: "Microservicios contenerizados",
    summary:
      "Servicios independientes por dominio de negocio (bounded contexts), cada uno con su " +
      "ciclo de despliegue y escalado horizontal.",
    bestFor: [
      "Productos con varios dominios de negocio claramente delimitados",
      "Partes del sistema con cargas muy distintas que deben escalar por separado",
      "Varios equipos trabajando en paralelo",
    ],
    notRecommendedWhen: [
      "MVP o dominio aún cambiante",
      "Equipo pequeño sin experiencia operando clústeres",
      "Muchas operaciones que requieren transacciones entre dominios",
    ],
    persistence: "Una base de datos por servicio (database-per-service). Consistencia eventual " +
      "entre servicios, con patrón Saga para operaciones que cruzan dominios.",
    backend: "Un servicio por dominio, cada uno con su propio repositorio de código o carpeta, " +
      "API interna y base de datos.",
    frontend: "SPA que consume únicamente el API Gateway, nunca los servicios directamente.",
    communication:
      "Interna con gRPC y Protocol Buffers; externa hacia el frontend mediante un API " +
      "Gateway unificado (REST o GraphQL Federation).",
    infrastructure:
      "Kubernetes o contenedores administrados (Azure Container Apps, AWS ECS), con " +
      "service mesh y mTLS entre servicios. Imágenes en un registry privado.",
    operation:
      "Trazas distribuidas con un id de correlación (OpenTelemetry), logs centralizados, " +
      "métricas y health checks por servicio, despliegue independiente por servicio.",
    auth:
      "Un servicio de identidad emite JWT tras el login o el SSO (OIDC); el API Gateway valida " +
      "el token y cada servicio verifica los permisos de su propio dominio.",
  },
  {
    key: "event-driven-cqrs",
    name: "Orientada a eventos (EDA) con CQRS",
    summary:
      "Las operaciones se publican como eventos y se procesan de forma asíncrona, separando " +
      "el modelo de escritura del de lectura. Las tareas pesadas no bloquean la respuesta al " +
      "usuario.",
    bestFor: [
      "Ingestión masiva de datos",
      "Tareas asíncronas pesadas: notificaciones, analítica, procesamiento en segundo plano",
      "Lecturas mucho más frecuentes o complejas que las escrituras",
    ],
    notRecommendedWhen: [
      "CRUD simple donde el usuario espera ver su cambio de inmediato en todas partes",
      "Equipo sin experiencia en consistencia eventual",
    ],
    persistence: "Modelo de escritura (Command) separado de un modelo de lectura optimizado " +
      "(Query), sincronizados mediante un bus de eventos persistente (Apache Kafka o RabbitMQ).",
    backend: "API que recibe comandos y publica eventos; workers independientes que consumen los " +
      "eventos y actualizan los modelos de lectura.",
    frontend: "SPA que envía comandos por REST y recibe actualizaciones de estado en vivo.",
    communication: "Asíncrona mediante colas y tópicos; el frontend recibe actualizaciones por " +
      "WebSockets o Server-Sent Events (SSE).",
    infrastructure: "Broker de mensajes gestionado o en contenedores, API y workers en " +
      "contenedores separados.",
    operation: "Workers que escalan automáticamente según la profundidad de la cola (queue lag); " +
      "monitoreo del retraso de cada consumidor, colas de mensajes fallidos (dead-letter queue) " +
      "y reintentos idempotentes.",
    auth: "JWT o sesión validados en la API de comandos; cada evento lleva el id del usuario que " +
      "lo originó para trazabilidad. Las conexiones WebSocket/SSE se autentican al abrirse y " +
      "solo reciben eventos de recursos a los que el usuario tiene acceso.",
  },
  {
    key: "edge-first",
    name: "Edge-first distribuida",
    summary:
      "La aplicación se ejecuta en puntos de presencia (PoPs) cercanos al usuario, con datos " +
      "replicados en el borde. Logra latencias menores a 50 ms sin infraestructura multirregión.",
    bestFor: [
      "Audiencia global o geográficamente distribuida",
      "Productos de lectura intensiva donde la latencia es crítica",
    ],
    notRecommendedWhen: [
      "Escrituras frecuentes que requieren consistencia fuerte global",
      "Procesos largos o con mucho uso de CPU (los entornos edge limitan tiempo y memoria)",
      "Datos que por regulación deben quedar en una sola región",
    ],
    persistence: "Bases de datos replicadas en el borde (SQL o clave-valor replicado, como " +
      "Cloudflare D1/KV o Turso), con una región primaria para escrituras.",
    backend:
      "Funciones edge sin estado ejecutadas en el PoP más cercano (Cloudflare Workers, Deno " +
      "Deploy o Vercel Edge Functions).",
    frontend: "Sitio renderizado o servido desde el mismo borde, con estáticos en la CDN.",
    communication: "HTTP/3, API REST y gRPC-Web ejecutadas en los PoPs.",
    infrastructure: "Plataforma edge gestionada, sin servidores ni sistemas operativos que " +
      "administrar; arranque sin cold start.",
    operation: "Configuración y secretos gestionados en el proveedor edge; logs y métricas por " +
      "región desde su panel; despliegue global atómico con rollback.",
    auth:
      "Tokens JWT firmados y verificables en el borde sin consultar una base central; SSO por " +
      "OIDC resuelto en una función edge. La autorización se evalúa en cada función.",
  },
];

export function listArchitectures(): ArchitectureTemplate[] {
  return structuredClone([...ARCHITECTURES]);
}

export function findArchitecture(key: string): ArchitectureTemplate | undefined {
  return ARCHITECTURES.find((a) => a.key === key);
}
