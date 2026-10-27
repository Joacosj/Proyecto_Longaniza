/**
 * Proyecto de ejemplo completo y coherente: reservas de salas de estudio.
 * Lo usan el motor falso y las pruebas del validador y del generador de documentos. El validador debe
 * encontrar cero inconsistencias en él; cada prueba lo rompe a propósito para verificar
 * que una regla funciona.
 */
import type { ProjectContext } from "./types.ts";

export function ejemplo(): ProjectContext {
  return structuredClone(EJEMPLO);
}

const EJEMPLO: ProjectContext = {
  projectName: "Reserva de Salas UAI",
  initialIdea: "Una app para que los estudiantes reserven salas de estudio de la biblioteca " +
    "sin tener que ir al mesón.",
  answeredQuestions: [
    {
      stage: "definition",
      text: "¿Cómo inician sesión los estudiantes?",
      answer: "Con su cuenta institucional de Microsoft (SSO). No habrá registro con contraseña.",
    },
    {
      stage: "definition",
      text: "¿Cuánto puede durar una reserva y cuántas puede tener un estudiante a la vez?",
      answer: "Máximo 2 horas por reserva y máximo 2 reservas activas por estudiante.",
    },
  ],
  openQuestions: [
    {
      stage: "definition",
      text: "¿Se enviarán recordatorios por correo antes de la reserva?",
      isBlocking: false,
    },
  ],
  stages: {
    definition: {
      problem: {
        statement: "Los estudiantes deben ir al mesón de la biblioteca para reservar una sala " +
          "de estudio y no saben de antemano cuáles están libres.",
        context: "Biblioteca universitaria con 12 salas de estudio grupales, en horario de " +
          "08:00 a 21:00, de lunes a viernes.",
        expectedImprovement: "Que cualquier estudiante vea la disponibilidad y reserve desde su " +
          "celular en menos de un minuto, y que las salas no queden tomadas por personas ausentes.",
      },
      userTypes: [
        {
          id: "ROLE-1",
          name: "Estudiante",
          description: "Alumno regular con cuenta institucional.",
          goals: ["Encontrar una sala libre", "Reservarla rápido", "Cancelar si no la usará"],
        },
        {
          id: "ROLE-2",
          name: "Administrador de biblioteca",
          description: "Funcionario de biblioteca que gestiona las salas.",
          goals: ["Mantener actualizado el catálogo de salas", "Desactivar salas en mantención"],
        },
      ],
      expectedOutcomes: [
        "El 80% de las reservas se hace desde la app durante el primer mes.",
        "No existen dos reservas superpuestas para la misma sala.",
      ],
      mvp: {
        included: [
          {
            id: "FEAT-1",
            title: "Ver disponibilidad",
            description: "Ver salas y bloques libres de un día.",
          },
          {
            id: "FEAT-2",
            title: "Reservar sala",
            description: "Reservar un bloque libre y ver mis reservas.",
          },
          { id: "FEAT-3", title: "Cancelar reserva", description: "Cancelar una reserva propia." },
          {
            id: "FEAT-4",
            title: "Administrar salas",
            description: "Crear, editar y desactivar salas.",
          },
        ],
        excluded: [
          { title: "Recordatorios por correo", reason: "No es necesario para validar el uso." },
          { title: "Check-in con código QR", reason: "Requiere hardware en las salas." },
        ],
      },
      mainJourney: [
        {
          step: 1,
          actorRoleId: "ROLE-1",
          action: "Inicia sesión con su cuenta institucional",
          result: "Ve la lista de salas del día",
        },
        {
          step: 2,
          actorRoleId: "ROLE-1",
          action: "Elige una fecha y revisa los bloques libres",
          result: "Ve la disponibilidad por sala",
        },
        {
          step: 3,
          actorRoleId: "ROLE-1",
          action: "Selecciona sala, hora de inicio y duración, y confirma",
          result: "La reserva queda creada",
        },
        {
          step: 4,
          actorRoleId: "ROLE-1",
          action: "Abre Mis reservas",
          result: "Ve su reserva y puede cancelarla",
        },
      ],
      requirements: [
        {
          id: "REQ-1",
          description: "Listar las salas activas con sus bloques ocupados para una fecha.",
          featureId: "FEAT-1",
          roleIds: ["ROLE-1", "ROLE-2"],
        },
        {
          id: "REQ-2",
          description: "Crear una reserva para una sala, fecha, hora de inicio y fin.",
          featureId: "FEAT-2",
          roleIds: ["ROLE-1"],
        },
        {
          id: "REQ-3",
          description: "Listar las reservas propias futuras.",
          featureId: "FEAT-2",
          roleIds: ["ROLE-1"],
        },
        {
          id: "REQ-4",
          description: "Cancelar una reserva propia.",
          featureId: "FEAT-3",
          roleIds: ["ROLE-1"],
        },
        {
          id: "REQ-5",
          description: "Crear y editar salas, incluida su activación.",
          featureId: "FEAT-4",
          roleIds: ["ROLE-2"],
        },
      ],
      businessRules: [
        {
          id: "RULE-1",
          rule: "Una reserva dura entre 30 minutos y 2 horas, en múltiplos de 30 minutos.",
        },
        { id: "RULE-2", rule: "Dos reservas activas de la misma sala no pueden superponerse." },
        { id: "RULE-3", rule: "Un estudiante puede tener como máximo 2 reservas activas futuras." },
        { id: "RULE-4", rule: "Solo se puede cancelar hasta 1 hora antes del inicio." },
        {
          id: "RULE-5",
          rule:
            "Las reservas solo pueden ser entre 08:00 y 21:00, de lunes a viernes, hora de Chile.",
        },
      ],
      constraints: ["Debe funcionar bien en celulares.", "Horario en zona America/Santiago."],
      integrations: [
        {
          name: "Microsoft Entra ID",
          purpose: "Inicio de sesión institucional (SSO con OpenID Connect).",
          onFailure: "Mostrar 'No se pudo iniciar sesión, intenta de nuevo' y no crear sesión.",
        },
      ],
      security: [
        "Solo usuarios con correo @uai.cl o @alumnos.uai.cl pueden ingresar.",
        "Un estudiante no puede ver ni cancelar reservas de otros.",
      ],
      edgeCases: [
        {
          situation: "Dos estudiantes reservan el mismo bloque al mismo tiempo",
          expectedBehavior:
            "Solo una reserva se crea; la otra recibe 409 con el mensaje 'El bloque ya fue reservado'.",
        },
        {
          situation: "La sala fue desactivada",
          expectedBehavior: "No aparece en la lista y reservarla responde 404.",
        },
        {
          situation: "Cancelar con menos de 1 hora de anticipación",
          expectedBehavior: "Responde 409 y la reserva sigue activa.",
        },
      ],
    },
    database: {
      overview: "Tres tablas: usuarios, salas y reservas. La regla de no superposición se " +
        "garantiza en la base con una restricción de exclusión.",
      entities: [
        {
          name: "users",
          description: "Personas que ingresan con SSO.",
          supports: ["REQ-2", "REQ-5"],
          attributes: [
            {
              name: "id",
              type: "uuid",
              nullable: false,
              primaryKey: true,
              unique: true,
              default: "gen_random_uuid()",
            },
            { name: "email", type: "text", nullable: false, primaryKey: false, unique: true },
            { name: "name", type: "text", nullable: false, primaryKey: false, unique: false },
            {
              name: "role",
              type: "text",
              nullable: false,
              primaryKey: false,
              unique: false,
              default: "'student'",
              description: "'student' (ROLE-1) o 'admin' (ROLE-2)",
            },
            {
              name: "created_at",
              type: "timestamptz",
              nullable: false,
              primaryKey: false,
              unique: false,
              default: "now()",
            },
          ],
          indexes: [],
          constraints: ["CHECK (role IN ('student','admin'))"],
        },
        {
          name: "rooms",
          description: "Salas de estudio.",
          supports: ["REQ-1", "REQ-5"],
          attributes: [
            {
              name: "id",
              type: "uuid",
              nullable: false,
              primaryKey: true,
              unique: true,
              default: "gen_random_uuid()",
            },
            { name: "name", type: "text", nullable: false, primaryKey: false, unique: true },
            {
              name: "capacity",
              type: "integer",
              nullable: false,
              primaryKey: false,
              unique: false,
            },
            { name: "location", type: "text", nullable: false, primaryKey: false, unique: false },
            {
              name: "is_active",
              type: "boolean",
              nullable: false,
              primaryKey: false,
              unique: false,
              default: "true",
            },
          ],
          indexes: [],
          constraints: ["CHECK (capacity BETWEEN 1 AND 20)"],
        },
        {
          name: "reservations",
          description: "Reserva de un bloque de una sala por un estudiante.",
          supports: ["REQ-2", "REQ-3", "REQ-4"],
          attributes: [
            {
              name: "id",
              type: "uuid",
              nullable: false,
              primaryKey: true,
              unique: true,
              default: "gen_random_uuid()",
            },
            { name: "room_id", type: "uuid", nullable: false, primaryKey: false, unique: false },
            { name: "user_id", type: "uuid", nullable: false, primaryKey: false, unique: false },
            {
              name: "starts_at",
              type: "timestamptz",
              nullable: false,
              primaryKey: false,
              unique: false,
            },
            {
              name: "ends_at",
              type: "timestamptz",
              nullable: false,
              primaryKey: false,
              unique: false,
            },
            {
              name: "status",
              type: "text",
              nullable: false,
              primaryKey: false,
              unique: false,
              default: "'active'",
            },
            {
              name: "created_at",
              type: "timestamptz",
              nullable: false,
              primaryKey: false,
              unique: false,
              default: "now()",
            },
          ],
          indexes: [{ columns: ["user_id", "starts_at"], unique: false }],
          constraints: [
            "CHECK (status IN ('active','cancelled'))",
            "CHECK (ends_at > starts_at)",
            "EXCLUDE USING gist (room_id WITH =, tstzrange(starts_at, ends_at) WITH &&) WHERE (status = 'active')",
          ],
        },
      ],
      relationships: [
        {
          from: "reservations",
          fromColumn: "room_id",
          to: "rooms",
          toColumn: "id",
          cardinality: "1:N",
          onDelete: "restrict",
        },
        {
          from: "reservations",
          fromColumn: "user_id",
          to: "users",
          toColumn: "id",
          cardinality: "1:N",
          onDelete: "cascade",
        },
      ],
    },
    backend: {
      overview: "API REST JSON bajo el prefijo /api.",
      auth: {
        scheme: "Cookie de sesión HttpOnly",
        description: "Tras el SSO, el backend crea una sesión y envía la cookie 'sid'. Sin " +
          "cookie válida: 401. Con cookie pero sin el rol requerido: 403.",
      },
      endpoints: [
        {
          id: "EP-1",
          method: "GET",
          path: "/rooms",
          summary: "Lista salas activas con sus bloques ocupados en una fecha.",
          requiresAuth: true,
          allowedRoleIds: [],
          entities: ["rooms", "reservations"],
          requirementIds: ["REQ-1"],
          request: {
            pathParams: [],
            headers: [],
            body: [],
            queryParams: [{
              name: "date",
              type: "string",
              required: true,
              validation: "Formato YYYY-MM-DD",
            }],
          },
          responses: [
            {
              status: 200,
              when: "Siempre que la fecha sea válida",
              body: [{
                name: "rooms",
                type: "array<{id, name, capacity, location, busy: array<{starts_at, ends_at}>}>",
                required: true,
              }],
            },
            {
              status: 400,
              when: "Falta date o tiene mal formato",
              body: [{ name: "error", type: "object", required: true }],
            },
            {
              status: 401,
              when: "Sin sesión",
              body: [{ name: "error", type: "object", required: true }],
            },
          ],
        },
        {
          id: "EP-2",
          method: "POST",
          path: "/reservations",
          summary: "Crea una reserva.",
          requiresAuth: true,
          allowedRoleIds: ["ROLE-1"],
          entities: ["reservations", "rooms"],
          requirementIds: ["REQ-2"],
          request: {
            pathParams: [],
            queryParams: [],
            headers: [],
            body: [
              { name: "room_id", type: "uuid", required: true },
              {
                name: "starts_at",
                type: "datetime ISO 8601",
                required: true,
                validation: "Múltiplo de 30 minutos, dentro del horario (RULE-5)",
              },
              {
                name: "ends_at",
                type: "datetime ISO 8601",
                required: true,
                validation: "Duración entre 30 y 120 minutos (RULE-1)",
              },
            ],
          },
          responses: [
            {
              status: 201,
              when: "Reserva creada",
              body: [{ name: "id", type: "uuid", required: true }, {
                name: "status",
                type: "'active'",
                required: true,
              }],
            },
            {
              status: 401,
              when: "Sin sesión",
              body: [{ name: "error", type: "object", required: true }],
            },
            {
              status: 403,
              when: "El usuario no es estudiante",
              body: [{ name: "error", type: "object", required: true }],
            },
            {
              status: 404,
              when: "La sala no existe o está inactiva",
              body: [{ name: "error", type: "object", required: true }],
            },
            {
              status: 409,
              when:
                "El bloque ya está reservado (RULE-2) o el estudiante ya tiene 2 reservas activas (RULE-3)",
              body: [{ name: "error", type: "object", required: true }],
            },
            {
              status: 422,
              when: "Duración u horario inválidos (RULE-1, RULE-5)",
              body: [{ name: "error", type: "object", required: true }],
            },
          ],
        },
        {
          id: "EP-3",
          method: "GET",
          path: "/reservations/me",
          summary: "Lista las reservas activas futuras del usuario.",
          requiresAuth: true,
          allowedRoleIds: ["ROLE-1"],
          entities: ["reservations", "rooms"],
          requirementIds: ["REQ-3"],
          request: { pathParams: [], queryParams: [], headers: [], body: [] },
          responses: [
            {
              status: 200,
              when: "Siempre",
              body: [{
                name: "reservations",
                type: "array<{id, room_name, starts_at, ends_at}>",
                required: true,
              }],
            },
            {
              status: 401,
              when: "Sin sesión",
              body: [{ name: "error", type: "object", required: true }],
            },
            {
              status: 403,
              when: "El usuario no es estudiante",
              body: [{ name: "error", type: "object", required: true }],
            },
          ],
        },
        {
          id: "EP-4",
          method: "DELETE",
          path: "/reservations/:id",
          summary: "Cancela una reserva propia.",
          requiresAuth: true,
          allowedRoleIds: ["ROLE-1"],
          entities: ["reservations"],
          requirementIds: ["REQ-4"],
          request: {
            pathParams: [{ name: "id", type: "uuid", required: true }],
            queryParams: [],
            headers: [],
            body: [],
          },
          responses: [
            { status: 204, when: "Reserva cancelada", body: [] },
            {
              status: 401,
              when: "Sin sesión",
              body: [{ name: "error", type: "object", required: true }],
            },
            {
              status: 403,
              when: "La reserva es de otro usuario",
              body: [{ name: "error", type: "object", required: true }],
            },
            {
              status: 404,
              when: "La reserva no existe",
              body: [{ name: "error", type: "object", required: true }],
            },
            {
              status: 409,
              when: "Falta menos de 1 hora para el inicio (RULE-4) o ya estaba cancelada",
              body: [{ name: "error", type: "object", required: true }],
            },
          ],
        },
        {
          id: "EP-5",
          method: "POST",
          path: "/rooms",
          summary: "Crea una sala.",
          requiresAuth: true,
          allowedRoleIds: ["ROLE-2"],
          entities: ["rooms"],
          requirementIds: ["REQ-5"],
          request: {
            pathParams: [],
            queryParams: [],
            headers: [],
            body: [
              {
                name: "name",
                type: "string",
                required: true,
                validation: "1 a 60 caracteres, único",
              },
              { name: "capacity", type: "integer", required: true, validation: "1 a 20" },
              { name: "location", type: "string", required: true },
            ],
          },
          responses: [
            {
              status: 201,
              when: "Sala creada",
              body: [{ name: "id", type: "uuid", required: true }],
            },
            {
              status: 401,
              when: "Sin sesión",
              body: [{ name: "error", type: "object", required: true }],
            },
            {
              status: 403,
              when: "El usuario no es administrador",
              body: [{ name: "error", type: "object", required: true }],
            },
            {
              status: 409,
              when: "Ya existe una sala con ese nombre",
              body: [{ name: "error", type: "object", required: true }],
            },
            {
              status: 422,
              when: "Datos inválidos",
              body: [{ name: "error", type: "object", required: true }],
            },
          ],
        },
        {
          id: "EP-6",
          method: "PATCH",
          path: "/rooms/:id",
          summary: "Edita una sala o la activa/desactiva.",
          requiresAuth: true,
          allowedRoleIds: ["ROLE-2"],
          entities: ["rooms"],
          requirementIds: ["REQ-5"],
          request: {
            pathParams: [{ name: "id", type: "uuid", required: true }],
            queryParams: [],
            headers: [],
            body: [
              { name: "name", type: "string", required: false },
              { name: "capacity", type: "integer", required: false, validation: "1 a 20" },
              { name: "location", type: "string", required: false },
              { name: "is_active", type: "boolean", required: false },
            ],
          },
          responses: [
            {
              status: 200,
              when: "Sala actualizada",
              body: [{ name: "id", type: "uuid", required: true }],
            },
            {
              status: 401,
              when: "Sin sesión",
              body: [{ name: "error", type: "object", required: true }],
            },
            {
              status: 403,
              when: "El usuario no es administrador",
              body: [{ name: "error", type: "object", required: true }],
            },
            {
              status: 404,
              when: "La sala no existe",
              body: [{ name: "error", type: "object", required: true }],
            },
            {
              status: 409,
              when: "Nombre duplicado",
              body: [{ name: "error", type: "object", required: true }],
            },
            {
              status: 422,
              when: "Datos inválidos",
              body: [{ name: "error", type: "object", required: true }],
            },
          ],
        },
        {
          id: "EP-7",
          method: "GET",
          path: "/auth/me",
          summary: "Devuelve el usuario de la sesión actual.",
          requiresAuth: true,
          allowedRoleIds: [],
          entities: ["users"],
          requirementIds: [],
          request: { pathParams: [], queryParams: [], headers: [], body: [] },
          responses: [
            {
              status: 200,
              when: "Hay sesión",
              body: [{ name: "id", type: "uuid", required: true }, {
                name: "name",
                type: "string",
                required: true,
              }, { name: "role", type: "'student' | 'admin'", required: true }],
            },
            {
              status: 401,
              when: "Sin sesión",
              body: [{ name: "error", type: "object", required: true }],
            },
          ],
        },
      ],
    },
    frontend: {
      entryScreenId: "SCR-1",
      screens: [
        {
          id: "SCR-1",
          name: "Inicio de sesión",
          purpose: "Ingresar con la cuenta institucional.",
          visibleToRoleIds: [],
          featureIds: [],
          layout: [
            { region: "main", component: "title", label: "Reserva de Salas" },
            { region: "main", component: "button", label: "Ingresar con cuenta UAI" },
          ],
          actions: [{ label: "Ingresar con cuenta UAI", endpointId: "EP-7", navigatesTo: "SCR-2" }],
          states: {
            empty: "—",
            loading: "Redirigiendo al inicio de sesión…",
            error: "No se pudo iniciar sesión, intenta de nuevo.",
          },
        },
        {
          id: "SCR-2",
          name: "Salas disponibles",
          purpose: "Ver la disponibilidad de las salas en una fecha.",
          visibleToRoleIds: ["ROLE-1", "ROLE-2"],
          featureIds: ["FEAT-1"],
          layout: [
            {
              region: "header",
              component: "nav",
              label: "Menú",
              fields: ["Salas", "Mis reservas", "Administrar salas"],
            },
            { region: "main", component: "form", label: "Fecha", fields: ["date"] },
            {
              region: "main",
              component: "table",
              label: "Salas",
              fields: ["Nombre", "Capacidad", "Ubicación", "Bloques ocupados"],
            },
          ],
          actions: [
            { label: "Ver disponibilidad", endpointId: "EP-1" },
            { label: "Reservar", navigatesTo: "SCR-3", visibleToRoleIds: ["ROLE-1"] },
            { label: "Mis reservas", navigatesTo: "SCR-4", visibleToRoleIds: ["ROLE-1"] },
            { label: "Administrar salas", navigatesTo: "SCR-5", visibleToRoleIds: ["ROLE-2"] },
          ],
          states: {
            empty: "No hay salas activas.",
            loading: "Cargando salas…",
            error: "No se pudo cargar la disponibilidad.",
          },
        },
        {
          id: "SCR-3",
          name: "Nueva reserva",
          purpose: "Reservar un bloque de una sala.",
          visibleToRoleIds: ["ROLE-1"],
          featureIds: ["FEAT-2"],
          layout: [
            { region: "main", component: "title", label: "Nueva reserva" },
            {
              region: "main",
              component: "form",
              label: "Datos de la reserva",
              fields: ["Sala", "Fecha", "Hora de inicio", "Duración"],
            },
            { region: "main", component: "button", label: "Confirmar reserva" },
          ],
          actions: [
            { label: "Confirmar reserva", endpointId: "EP-2", navigatesTo: "SCR-4" },
            { label: "Volver", navigatesTo: "SCR-2" },
          ],
          states: {
            empty: "—",
            loading: "Creando reserva…",
            error: "Muestra el mensaje del 409 o 422 junto al formulario.",
          },
        },
        {
          id: "SCR-4",
          name: "Mis reservas",
          purpose: "Ver y cancelar las reservas propias.",
          visibleToRoleIds: ["ROLE-1"],
          featureIds: ["FEAT-2", "FEAT-3"],
          layout: [
            { region: "main", component: "title", label: "Mis reservas" },
            {
              region: "main",
              component: "list",
              label: "Reservas",
              fields: ["Sala", "Fecha", "Horario", "Cancelar"],
            },
          ],
          actions: [
            { label: "Cargar reservas", endpointId: "EP-3" },
            { label: "Cancelar reserva", endpointId: "EP-4" },
            { label: "Volver a salas", navigatesTo: "SCR-2" },
          ],
          states: {
            empty: "No tienes reservas.",
            loading: "Cargando…",
            error: "No se pudieron cargar tus reservas.",
          },
        },
        {
          id: "SCR-5",
          name: "Administrar salas",
          purpose: "Crear, editar y desactivar salas.",
          visibleToRoleIds: ["ROLE-2"],
          featureIds: ["FEAT-4"],
          layout: [
            {
              region: "main",
              component: "table",
              label: "Salas",
              fields: ["Nombre", "Capacidad", "Ubicación", "Activa"],
            },
            {
              region: "modal",
              component: "form",
              label: "Sala",
              fields: ["Nombre", "Capacidad", "Ubicación", "Activa"],
            },
          ],
          actions: [
            { label: "Ver salas", endpointId: "EP-1" },
            { label: "Crear sala", endpointId: "EP-5" },
            { label: "Guardar cambios", endpointId: "EP-6" },
            { label: "Volver a salas", navigatesTo: "SCR-2" },
          ],
          states: {
            empty: "Aún no hay salas.",
            loading: "Guardando…",
            error: "No se pudo guardar la sala.",
          },
        },
      ],
      navigation: [
        { from: "SCR-1", to: "SCR-2", trigger: "Inicio de sesión exitoso" },
        { from: "SCR-2", to: "SCR-3", trigger: "Reservar" },
        { from: "SCR-2", to: "SCR-4", trigger: "Mis reservas" },
        { from: "SCR-2", to: "SCR-5", trigger: "Administrar salas" },
        { from: "SCR-3", to: "SCR-4", trigger: "Reserva creada" },
        { from: "SCR-3", to: "SCR-2", trigger: "Volver" },
        { from: "SCR-4", to: "SCR-2", trigger: "Volver a salas" },
        { from: "SCR-5", to: "SCR-2", trigger: "Volver a salas" },
      ],
    },
    architecture: {
      selectedKey: "modular-monolith",
      justification: "Es un MVP con un solo dominio (reservas), tres tablas y dos roles. Las " +
        "reglas RULE-2 y RULE-3 requieren transacciones sobre la misma base, que un monolito " +
        "resuelve sin consistencia eventual. El equipo es pequeño y no necesita escalar por partes.",
      discarded: [
        {
          key: "jamstack-baas",
          reason: "RULE-2 a RULE-5 son reglas transaccionales que no caben bien en políticas RLS.",
        },
        {
          key: "microservices",
          reason: "Un solo dominio pequeño; la complejidad operativa no se justifica.",
        },
        { key: "event-driven-cqrs", reason: "No hay procesamiento asíncrono pesado." },
        { key: "edge-first", reason: "Audiencia en un solo campus; la latencia no es crítica." },
      ],
      stack: {
        database: "PostgreSQL 16 con la extensión btree_gist",
        backend: "Node.js 22 + TypeScript + Fastify 5 + Drizzle ORM",
        frontend: "React 18 + Vite + TypeScript",
        communication: "REST con JSON",
      },
      deployment: {
        strategy: "Una imagen Docker multi-stage para el backend que también sirve el frontend " +
          "compilado; PostgreSQL gestionado. Docker Compose en desarrollo.",
        environments: ["development", "production"],
        envVars: [
          { name: "DATABASE_URL", purpose: "Conexión a PostgreSQL" },
          {
            name: "SESSION_SECRET",
            purpose: "Firma de la cookie de sesión (mínimo 32 caracteres)",
          },
          { name: "ENTRA_CLIENT_ID", purpose: "Aplicación registrada en Microsoft Entra ID" },
          { name: "ENTRA_CLIENT_SECRET", purpose: "Secreto de esa aplicación" },
          { name: "ENTRA_TENANT_ID", purpose: "Tenant de la universidad" },
        ],
      },
      observability: {
        logging: "Logs JSON a stdout con id de solicitud, usuario, ruta, estado y duración.",
        metrics: "Contador de reservas creadas y canceladas; latencia y errores por ruta.",
        tracing: "Id de solicitud propagado en el header X-Request-Id.",
        healthChecks: "GET /api/health (proceso) y GET /api/health/db (base de datos).",
      },
      auth: {
        identity: "Microsoft Entra ID de la universidad.",
        sso: "OpenID Connect, flujo authorization code con PKCE.",
        session: "Cookie HttpOnly, Secure, SameSite=Lax con id de sesión; duración 8 horas.",
        authorization: "Middleware que carga el usuario y verifica el rol requerido por cada " +
          "endpoint; la propiedad de una reserva se valida en el backend antes de cancelarla.",
      },
    },
  },
};
