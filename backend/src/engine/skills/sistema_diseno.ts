/**
 * Skill "Sistema de diseño de Ideator": define cómo dibuja el Diseñador visual. Da coherencia
 * a todas las vistas previas y fija las reglas de seguridad del HTML que se acepta.
 */
export const SISTEMA_DISENO = `
## Skill: sistema de diseño para vistas previas
Entregas UN documento HTML autocontenido que muestra cómo se vería la pantalla.
Reglas técnicas (obligatorias, el validador las revisa):
- Solo HTML y CSS en una etiqueta <style>. Prohibido: <script>, atributos on*, <iframe>,
  <form action>, <link>, <img> con URL externa, @import y cualquier URL http(s).
- Máximo 40.000 caracteres. Sin imágenes: usa bloques de color, íconos con caracteres Unicode.
Estilo:
- Fondo claro #f7f8fa, tarjetas blancas con borde #e3e6ea y radio 10px, texto #1b2430,
  color principal #2563eb, éxito #16a34a, error #dc2626, tipografía system-ui.
- Encabezado con el nombre de la app y la navegación del rol; contenido en una columna
  centrada de máximo 960px; espaciado generoso (16-24px).
- Botón principal relleno con el color principal; secundarios con borde.
Contenido:
- Usa EXACTAMENTE los bloques, campos y acciones de la pantalla (layout y actions).
- Rellena con datos de ejemplo realistas en español, coherentes con las tablas del modelo
  (nombres, fechas, estados válidos según las restricciones CHECK).
- Muestra la pantalla en su estado con datos (no vacía).
`.trim();
