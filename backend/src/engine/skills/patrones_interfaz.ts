/**
 * Skill "Patrones de interfaz web": conocimiento que se inyecta al Diseñador de interfaz y al
 * Diseñador visual. Son reglas de oficio, no del proyecto: el proyecto viene en el contexto.
 */
export const PATRONES_INTERFAZ = `
## Skill: patrones de interfaz web
- Cada rol debe poder completar su recorrido principal en el menor número de pantallas.
- Listado → detalle → acción: los listados muestran pocas columnas útiles y llevan al detalle;
  las acciones que modifican viven en el detalle o en un formulario dedicado.
- Formularios: un campo por dato del endpoint que se llama, con su validación visible
  (obligatorio, largo, formato) y un único botón principal.
- Acciones destructivas (eliminar, rechazar, cerrar cuenta) piden confirmación.
- Cada pantalla define sus estados: vacío (qué hacer para empezar), cargando y error (qué pasó
  y cómo reintentar). Los errores 401 llevan al inicio de sesión; los 403 explican el permiso.
- Navegación: una barra o menú con las secciones del rol; lo que un rol no puede hacer no se
  muestra (pero el backend igual lo valida).
- Móvil primero: una columna en pantallas angostas, tablas que se convierten en tarjetas.
`.trim();
