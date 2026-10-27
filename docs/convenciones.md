# Convenciones del equipo

Basadas en las reglas del curso (clase 2).

## Ramas

- Una rama por épica. Nadie hace commits directos en `main`.
- Los cambios entran a `main` por pull request, revisado por otro integrante.

| Épica | Rama | Responsable |
|---|---|---|
| General (base, Docker, docs, CI) | `epic/general` | Todos |
| Plataforma y colaboración | `epic/plataforma` | Persona A |
| Definición del producto y modelo de datos | `epic/definicion-datos` | Persona B |
| Diseño técnico (API, frontend, arquitectura) | `epic/diseno-tecnico` | Persona C |
| Revisión y documentos finales | `epic/revision-documentos` | Persona C, con apoyo de A y B |

## Commits

Formato `<tipo>: descripción`, con tipos `feat`, `fix`, `docs` o `style`. Cada commit se asocia
a una tarea de Jira, incluyendo su clave para que la integración lo enlace:

```
feat: IDE-12 agrega login con usuario y contraseña
```

## Jira

- Story y Task son lo mismo. No se usan subtareas.
- Puntos de historia: solo 1, 3, 5 u 8. Una tarea de 8 equivale a más de 6 horas.
- Máximo 10 puntos por persona y 30 por sprint.

## Reparto de trabajo

### Persona A: plataforma
Autenticación (usuario y contraseña, SSO), sesiones, proyectos, miembros e invitaciones,
permisos validados en backend, trazabilidad (`audit_log`), control de concurrencia
(versión en `stages`, respuesta 409), pantalla de revisión consolidada, pruebas funcionales.

### Persona B: definición y datos
Diálogo de la etapa 1, detección de preguntas bloqueantes, propuesta y edición colaborativa del
modelo de datos con diagrama ER, validador de consistencia entre etapas.

### Persona C: diseño técnico y salida
Etapas de backend/API, frontend (mockups y mapa de pantallas) y arquitectura (catálogo de las
cinco arquitecturas), generación de los dos documentos Markdown.

## Reglas de código

- La autorización se valida siempre en el backend, nunca solo en la interfaz.
- 401 cuando no hay identidad válida; 403 cuando la hay pero no tiene permiso.
- Los errores usan `ApiError` (`backend/src/http/errors.ts`).
- El formato de cada etapa vive en `backend/src/contracts/artifacts.ts`. Cambiarlo requiere
  avisar al grupo, porque las demás etapas lo leen.
- Toda lógica de negocio nueva lleva pruebas.
