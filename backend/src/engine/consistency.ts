/**
 * Validador de consistencia entre etapas. Determinista: no usa la IA.
 *
 * Revisa que las referencias entre etapas (ids de roles, funcionalidades, requisitos,
 * entidades, endpoints y pantallas) existan y que cada decisión importante tenga su
 * contraparte en las etapas siguientes. Solo evalúa las etapas presentes en el contexto.
 *
 * Severidad:
 * - critical: la especificación es contradictoria o incompleta; bloquea la generación final.
 * - warning: algo probablemente falta, pero no impide generar los documentos.
 */
import type { ArchitectureTemplate, StageKind } from "../contracts/artifacts.ts";
import { ARCHITECTURES } from "./architectures.ts";
import type { Inconsistency, ProjectContext } from "./types.ts";

export function checkConsistency(
  context: ProjectContext,
  catalog: readonly ArchitectureTemplate[] = ARCHITECTURES,
): Inconsistency[] {
  const out: Inconsistency[] = [];
  const add = (severity: Inconsistency["severity"], stages: StageKind[], description: string) =>
    out.push({ severity, stages, description });

  const { definition: def, database: db, backend: be, frontend: fe, architecture: ar } =
    context.stages;

  const roleIds = new Set(def?.userTypes.map((r) => r.id) ?? []);
  const featureIds = new Set(def?.mvp.included.map((f) => f.id) ?? []);
  const requirementIds = new Set(def?.requirements.map((r) => r.id) ?? []);
  const entityByName = new Map(db?.entities.map((e) => [e.name, e]) ?? []);
  const endpointById = new Map(be?.endpoints.map((e) => [e.id, e]) ?? []);
  const screenIds = new Set(fe?.screens.map((s) => s.id) ?? []);

  // ------------------------------------------------------------ Definición
  if (def) {
    duplicates(def.userTypes.map((r) => r.id)).forEach((id) =>
      add("critical", ["definition"], `El rol ${id} está definido más de una vez.`)
    );
    duplicates(def.mvp.included.map((f) => f.id)).forEach((id) =>
      add("critical", ["definition"], `La funcionalidad ${id} está definida más de una vez.`)
    );
    duplicates(def.requirements.map((r) => r.id)).forEach((id) =>
      add("critical", ["definition"], `El requisito ${id} está definido más de una vez.`)
    );

    for (const req of def.requirements) {
      if (!featureIds.has(req.featureId)) {
        add(
          "critical",
          ["definition"],
          `El requisito ${req.id} pertenece a ${req.featureId}, que no está en el MVP.`,
        );
      }
      for (const r of req.roleIds.filter((r) => !roleIds.has(r))) {
        add(
          "critical",
          ["definition"],
          `El requisito ${req.id} menciona el rol ${r}, que no existe.`,
        );
      }
    }
    for (const step of def.mainJourney) {
      if (!roleIds.has(step.actorRoleId)) {
        add(
          "critical",
          ["definition"],
          `El paso ${step.step} del recorrido principal lo realiza ${step.actorRoleId}, que no existe.`,
        );
      }
    }
    for (const f of def.mvp.included) {
      if (!def.requirements.some((r) => r.featureId === f.id)) {
        add(
          "warning",
          ["definition"],
          `La funcionalidad ${f.id} (${f.title}) no tiene ningún requisito asociado.`,
        );
      }
    }
  }

  // ------------------------------------------------------------ Base de datos
  if (db) {
    duplicates(db.entities.map((e) => e.name)).forEach((n) =>
      add("critical", ["database"], `La entidad "${n}" está definida más de una vez.`)
    );
    for (const e of db.entities) {
      duplicates(e.attributes.map((a) => a.name)).forEach((a) =>
        add("critical", ["database"], `La entidad "${e.name}" repite el atributo "${a}".`)
      );
      if (!e.attributes.some((a) => a.primaryKey)) {
        add("critical", ["database"], `La entidad "${e.name}" no tiene clave primaria.`);
      }
      if (def) {
        if (e.supports.length === 0) {
          add(
            "warning",
            ["definition", "database"],
            `La entidad "${e.name}" no indica qué requisito o funcionalidad la justifica.`,
          );
        }
        for (const ref of e.supports) {
          if (!requirementIds.has(ref) && !featureIds.has(ref)) {
            add(
              "critical",
              ["definition", "database"],
              `La entidad "${e.name}" dice soportar ${ref}, que no existe en la definición.`,
            );
          }
        }
      }
      for (const idx of e.indexes) {
        for (const col of idx.columns.filter((c) => !hasColumn(e, c))) {
          add(
            "critical",
            ["database"],
            `Un índice de "${e.name}" usa la columna "${col}", que no existe.`,
          );
        }
      }
    }
    for (const rel of db.relationships) {
      const from = entityByName.get(rel.from);
      const to = entityByName.get(rel.to);
      const label = `${rel.from}.${rel.fromColumn} → ${rel.to}.${rel.toColumn}`;
      if (!from) {
        add("critical", ["database"], `La relación ${label} parte de una entidad inexistente.`);
      } else if (!hasColumn(from, rel.fromColumn)) {
        add(
          "critical",
          ["database"],
          `La relación ${label} usa la columna inexistente ${rel.from}.${rel.fromColumn}.`,
        );
      }
      if (!to) {
        add("critical", ["database"], `La relación ${label} apunta a una entidad inexistente.`);
      } else if (!hasColumn(to, rel.toColumn)) {
        add(
          "critical",
          ["database"],
          `La relación ${label} apunta a la columna inexistente ${rel.to}.${rel.toColumn}.`,
        );
      }
    }
  }

  // ------------------------------------------------------------ Backend
  if (be) {
    duplicates(be.endpoints.map((e) => e.id)).forEach((id) =>
      add("critical", ["backend"], `El endpoint ${id} está definido más de una vez.`)
    );
    duplicates(be.endpoints.map((e) => `${e.method} ${e.path}`)).forEach((route) =>
      add("critical", ["backend"], `La ruta ${route} está definida más de una vez.`)
    );

    for (const ep of be.endpoints) {
      const name = `${ep.id} (${ep.method} ${ep.path})`;
      const statuses = new Set(ep.responses.map((r) => r.status));

      if (db) {
        for (const ent of ep.entities.filter((n) => !entityByName.has(n))) {
          add(
            "critical",
            ["database", "backend"],
            `${name} usa la entidad "${ent}", que no existe en el modelo de datos.`,
          );
        }
      }
      if (def) {
        for (const r of ep.allowedRoleIds.filter((r) => !roleIds.has(r))) {
          add("critical", ["definition", "backend"], `${name} permite el rol ${r}, que no existe.`);
        }
        for (const r of ep.requirementIds.filter((r) => !requirementIds.has(r))) {
          add("critical", ["definition", "backend"], `${name} implementa ${r}, que no existe.`);
        }
      }
      if (ep.requiresAuth && !statuses.has(401)) {
        add("critical", ["backend"], `${name} requiere sesión pero no documenta la respuesta 401.`);
      }
      const restricted = ep.allowedRoleIds.length > 0 &&
        [...roleIds].some((r) => !ep.allowedRoleIds.includes(r));
      if (restricted && !statuses.has(403)) {
        add(
          "critical",
          ["backend"],
          `${name} está restringido a ${
            ep.allowedRoleIds.join(", ")
          } pero no documenta la respuesta 403.`,
        );
      }
      if (!ep.responses.some((r) => r.status >= 200 && r.status < 300)) {
        add("critical", ["backend"], `${name} no documenta ninguna respuesta exitosa.`);
      }
      const declared = new Set(ep.request.pathParams.map((p) => p.name));
      for (const param of pathParams(ep.path).filter((p) => !declared.has(p))) {
        add(
          "warning",
          ["backend"],
          `${name} usa el parámetro de ruta ":${param}" sin describirlo.`,
        );
      }
    }

    if (def) {
      for (const req of def.requirements) {
        if (!be.endpoints.some((e) => e.requirementIds.includes(req.id))) {
          add(
            "warning",
            ["definition", "backend"],
            `El requisito ${req.id} no está implementado por ningún endpoint.`,
          );
        }
      }
    }
  }

  // ------------------------------------------------------------ Frontend
  if (fe) {
    duplicates(fe.screens.map((s) => s.id)).forEach((id) =>
      add("critical", ["frontend"], `La pantalla ${id} está definida más de una vez.`)
    );
    duplicates(fe.screens.map((s) => s.route).filter((r): r is string => !!r)).forEach((r) =>
      add("critical", ["frontend"], `La ruta ${r} está asignada a más de una pantalla.`)
    );
    if (be) {
      const apiPaths = new Set(be.endpoints.map((e) => e.path));
      for (const s of fe.screens.filter((s) => s.route && apiPaths.has(s.route))) {
        add(
          "critical",
          ["frontend", "backend"],
          `La pantalla ${s.id} usa la ruta ${s.route}, que también es una ruta de la API.`,
        );
      }
    }
    if (!screenIds.has(fe.entryScreenId)) {
      add("critical", ["frontend"], `La pantalla de inicio ${fe.entryScreenId} no existe.`);
    }
    for (const nav of fe.navigation) {
      for (const id of [nav.from, nav.to].filter((id) => !screenIds.has(id))) {
        add(
          "critical",
          ["frontend"],
          `El mapa de navegación menciona la pantalla ${id}, que no existe.`,
        );
      }
    }

    const reachable = new Set<string>([fe.entryScreenId]);
    fe.navigation.forEach((n) => reachable.add(n.to));

    for (const s of fe.screens) {
      if (def) {
        for (const r of s.visibleToRoleIds.filter((r) => !roleIds.has(r))) {
          add(
            "critical",
            ["definition", "frontend"],
            `La pantalla ${s.id} se muestra al rol ${r}, que no existe.`,
          );
        }
        for (const f of s.featureIds.filter((f) => !featureIds.has(f))) {
          add(
            "critical",
            ["definition", "frontend"],
            `La pantalla ${s.id} implementa ${f}, que no está en el MVP.`,
          );
        }
      }
      for (const a of s.actions) {
        const label = `La acción "${a.label}" de ${s.id}`;
        if (a.navigatesTo) {
          reachable.add(a.navigatesTo);
          if (!screenIds.has(a.navigatesTo)) {
            add("critical", ["frontend"], `${label} lleva a ${a.navigatesTo}, que no existe.`);
          }
        }
        if (def) {
          for (const r of (a.visibleToRoleIds ?? []).filter((r) => !roleIds.has(r))) {
            add(
              "critical",
              ["definition", "frontend"],
              `${label} se muestra al rol ${r}, que no existe.`,
            );
          }
        }
        if (a.endpointId && be) {
          const ep = endpointById.get(a.endpointId);
          if (!ep) {
            add(
              "critical",
              ["backend", "frontend"],
              `${label} llama a ${a.endpointId}, que no existe.`,
            );
            continue;
          }
          const actors = a.visibleToRoleIds?.length ? a.visibleToRoleIds : s.visibleToRoleIds;
          const denied = ep.allowedRoleIds.length
            ? actors.filter((r) => !ep.allowedRoleIds.includes(r))
            : [];
          if (denied.length) {
            add(
              "critical",
              ["backend", "frontend"],
              `${label} se muestra a ${denied.join(", ")}, pero ${ep.id} no permite ese rol.`,
            );
          }
        }
      }
    }

    for (const s of fe.screens) {
      if (!reachable.has(s.id)) {
        add("warning", ["frontend"], `No hay forma de llegar a la pantalla ${s.id} (${s.name}).`);
      }
    }
    if (def) {
      for (const f of def.mvp.included) {
        if (!fe.screens.some((s) => s.featureIds.includes(f.id))) {
          add(
            "critical",
            ["definition", "frontend"],
            `La funcionalidad ${f.id} (${f.title}) no aparece en ninguna pantalla.`,
          );
        }
      }
    }
    if (be) {
      const used = new Set(fe.screens.flatMap((s) => s.actions.map((a) => a.endpointId)));
      for (const ep of be.endpoints.filter((e) => !used.has(e.id))) {
        add(
          "warning",
          ["backend", "frontend"],
          `El endpoint ${ep.id} (${ep.method} ${ep.path}) no se usa en ninguna pantalla.`,
        );
      }
    }
  }

  // ------------------------------------------------------------ Arquitectura
  if (ar) {
    const keys = new Set(catalog.map((a) => a.key));
    if (!keys.has(ar.selectedKey)) {
      add(
        "critical",
        ["architecture"],
        `La arquitectura elegida "${ar.selectedKey}" no está en el catálogo.`,
      );
    }
    for (const d of ar.discarded.filter((d) => !keys.has(d.key))) {
      add("warning", ["architecture"], `Se descarta "${d.key}", que no está en el catálogo.`);
    }
    for (const [part, value] of Object.entries(ar.stack)) {
      if (!value.trim()) {
        add(
          "critical",
          ["architecture"],
          `No se definió la tecnología de ${STACK_LABEL[part] ?? part}.`,
        );
      } else if (/\s(o|or)\s/i.test(value)) {
        add(
          "critical",
          ["architecture"],
          `La tecnología de ${
            STACK_LABEL[part] ?? part
          } deja alternativas abiertas ("${value}"). ` +
            "Hay que elegir una sola.",
        );
      }
    }
    if (!ar.justification.trim()) {
      add("critical", ["architecture"], "La elección de arquitectura no tiene justificación.");
    }
  }

  return out;
}

/** True si alguna inconsistencia impide generar los documentos finales. */
export function hasCritical(issues: Inconsistency[]): boolean {
  return issues.some((i) => i.severity === "critical");
}

const STACK_LABEL: Record<string, string> = {
  database: "base de datos",
  backend: "backend",
  frontend: "frontend",
  communication: "comunicación",
};

function duplicates(values: string[]): string[] {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const v of values) (seen.has(v) ? dup : seen).add(v);
  return [...dup];
}

function hasColumn(entity: { attributes: { name: string }[] }, column: string): boolean {
  return entity.attributes.some((a) => a.name === column);
}

function pathParams(path: string): string[] {
  return [...path.matchAll(/[:{]([A-Za-z_][A-Za-z0-9_]*)\}?/g)].map((m) => m[1]);
}
