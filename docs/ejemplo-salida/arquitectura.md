# Arquitectura: Reserva de Salas UAI

> **Instrucciones para quien implemente.** Usa exactamente las tecnologías y decisiones de este documento. El detalle funcional (tablas, endpoints y pantallas) está en la especificación de producto.

## 1. Arquitectura elegida

**Monolito modular moderno.** Una sola aplicación desplegable, organizada internamente en módulos por dominio. Reduce la sobrecarga operativa al evitar la latencia de red entre servicios y las transacciones distribuidas. Ideal cuando el modelo de negocio aún está iterando.

**Por qué:** Es un MVP con un solo dominio (reservas), tres tablas y dos roles. Las reglas RULE-2 y RULE-3 requieren transacciones sobre la misma base, que un monolito resuelve sin consistencia eventual. El equipo es pequeño y no necesita escalar por partes.

### Alternativas descartadas

| Arquitectura | Motivo |
|---|---|
| Jamstack / Serverless + BaaS | RULE-2 a RULE-5 son reglas transaccionales que no caben bien en políticas RLS. |
| Microservicios contenerizados | Un solo dominio pequeño; la complejidad operativa no se justifica. |
| Orientada a eventos (EDA) con CQRS | No hay procesamiento asíncrono pesado. |
| Edge-first distribuida | Audiencia en un solo campus; la latencia no es crítica. |

## 2. Tecnologías

| Capa | Tecnología |
|---|---|
| Base de datos | PostgreSQL 16 con la extensión btree_gist |
| Backend | Node.js 22 + TypeScript + Fastify 5 + Drizzle ORM |
| Frontend | React 18 + Vite + TypeScript |
| Comunicación | REST con JSON |

## 3. Base de datos

Motor: PostgreSQL 16 con la extensión btree_gist. Tablas: `users`, `rooms`, `reservations`. Las columnas, claves, índices y restricciones están en la sección 10 de la especificación de producto y deben crearse mediante migraciones versionadas.

## 4. Autenticación y autorización

- **Identidad:** Microsoft Entra ID de la universidad.
- **SSO:** OpenID Connect, flujo authorization code con PKCE.
- **Sesión o token:** Cookie HttpOnly, Secure, SameSite=Lax con id de sesión; duración 8 horas.
- **Autorización:** Middleware que carga el usuario y verifica el rol requerido por cada endpoint; la propiedad de una reserva se valida en el backend antes de cancelarla.
- **Roles:** ROLE-1 (Estudiante), ROLE-2 (Administrador de biblioteca)

La autorización se valida siempre en el backend. Sin identidad válida: 401. Con identidad pero sin permiso sobre el recurso: 403.

## 5. Despliegue

Una imagen Docker multi-stage para el backend que también sirve el frontend compilado; PostgreSQL gestionado. Docker Compose en desarrollo.

**Ambientes:** development, production.

**Variables de entorno** (los secretos nunca van en el código ni en el repositorio):

| Variable | Uso |
|---|---|
| `DATABASE_URL` | Conexión a PostgreSQL |
| `SESSION_SECRET` | Firma de la cookie de sesión (mínimo 32 caracteres) |
| `ENTRA_CLIENT_ID` | Aplicación registrada en Microsoft Entra ID |
| `ENTRA_CLIENT_SECRET` | Secreto de esa aplicación |
| `ENTRA_TENANT_ID` | Tenant de la universidad |

## 6. Observabilidad

| Aspecto | Decisión |
|---|---|
| Logs | Logs JSON a stdout con id de solicitud, usuario, ruta, estado y duración. |
| Métricas | Contador de reservas creadas y canceladas; latencia y errores por ruta. |
| Trazabilidad | Id de solicitud propagado en el header X-Request-Id. |
| Verificación de estado | GET /api/health (proceso) y GET /api/health/db (base de datos). |
