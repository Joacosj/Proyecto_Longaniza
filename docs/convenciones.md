# Convenciones del equipo

Basadas en las reglas del curso (clase 2).

## Ramas

- Una rama por épica. Nadie hace commits directos en `main`.
- Los cambios entran a `main` por pull request, revisado por otro integrante.

| Épica | Rama | Mitad | Tareas |
|---|---|---|---|
| General (base, Docker, docs) | `epic/general` | Ambas | — |
| Plataforma y colaboración | `epic/plataforma` | A | A1 a A9 |
| Definición y preguntas bloqueantes | `epic/definicion` | B | B5, B6, B8 |
| Diseño técnico (datos, API, frontend, arquitectura) | `epic/diseno-tecnico` | B | B4, B7 |
| Revisión y documentos finales | `epic/revision-documentos` | B | B1, B2, B3, B9 |

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

El proyecto se divide en dos mitades independientes, unidas por la interfaz `Engine`
(`backend/src/engine/types.ts`):

- **Mitad A, plataforma:** usuarios, permisos, base de datos, rutas HTTP y aplicación web.
  Instrucciones completas en `docs/mitad-a-plataforma.md` (40 pts).
- **Mitad B, motor:** IA, preguntas bloqueantes, generación de etapas, validación de
  consistencia y documentos Markdown. Instrucciones completas en `docs/mitad-b-motor.md` (43 pts).

La mitad A trabaja con `createFakeEngine()` hasta que la mitad B entregue el motor real, así
ninguna espera a la otra. Cada archivo de instrucciones está pensado para entregárselo completo
a un asistente de IA.

## Reglas de código

- La autorización se valida siempre en el backend, nunca solo en la interfaz.
- 401 cuando no hay identidad válida; 403 cuando la hay pero no tiene permiso.
- Los errores usan `ApiError` (`backend/src/http/errors.ts`).
- El formato de cada etapa vive en `backend/src/contracts/artifacts.ts`. Cambiarlo requiere
  avisar al grupo, porque las demás etapas lo leen.
- Toda lógica de negocio nueva lleva pruebas.
