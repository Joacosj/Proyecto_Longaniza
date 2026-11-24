/**
 * Enrutador mínimo por hash (#/proyectos/...). No requiere configurar el servidor de Vite
 * ni agregar dependencias.
 */
import { useEffect, useState } from "react";

export type Route =
  | { name: "login"; next?: string; error?: string }
  | { name: "register"; next?: string }
  | { name: "projects" }
  | { name: "project"; id: string; tab: "stages" | "agents" | "members" | "review" | "activity"; stage?: string }
  | { name: "invitation"; token: string }
  | { name: "notFound" };

export function parse(hash: string): Route {
  const [path, query = ""] = hash.replace(/^#/, "").split("?");
  const params = new URLSearchParams(query);
  const parts = path.split("/").filter(Boolean).map(decodeURIComponent);
  const next = params.get("next") ?? undefined;

  if (parts.length === 0) return { name: "projects" };
  if (parts[0] === "login") {
    return { name: "login", next, error: params.get("error") ?? undefined };
  }
  if (parts[0] === "registro") return { name: "register", next };
  if (parts[0] === "invitaciones" && parts[1]) return { name: "invitation", token: parts[1] };
  if (parts[0] === "proyectos") {
    if (!parts[1]) return { name: "projects" };
    const id = parts[1];
    if (!parts[2] || parts[2] === "etapas") {
      return { name: "project", id, tab: "stages", stage: parts[3] };
    }
    if (parts[2] === "miembros") return { name: "project", id, tab: "members" };
    if (parts[2] === "agentes") return { name: "project", id, tab: "agents" };
    if (parts[2] === "revision") return { name: "project", id, tab: "review" };
    if (parts[2] === "actividad") return { name: "project", id, tab: "activity" };
  }
  return { name: "notFound" };
}

export const paths = {
  login: (next?: string) => `#/login${next ? `?next=${encodeURIComponent(next)}` : ""}`,
  register: (next?: string) => `#/registro${next ? `?next=${encodeURIComponent(next)}` : ""}`,
  projects: () => "#/proyectos",
  stage: (id: string, kind?: string) => `#/proyectos/${id}/etapas${kind ? `/${kind}` : ""}`,
  members: (id: string) => `#/proyectos/${id}/miembros`,
  agents: (id: string) => `#/proyectos/${id}/agentes`,
  review: (id: string) => `#/proyectos/${id}/revision`,
  activity: (id: string) => `#/proyectos/${id}/actividad`,
  invitation: (token: string) => `#/invitaciones/${encodeURIComponent(token)}`,
};

export function navigate(hash: string) {
  if (location.hash === hash) return;
  location.hash = hash;
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parse(location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parse(location.hash));
    addEventListener("hashchange", onChange);
    return () => removeEventListener("hashchange", onChange);
  }, []);
  return route;
}
