import { client } from "../api";
import { paths, type Route } from "../router";
import { errorText, Loading, Notice, RoleTag, useLoad } from "../ui";
import { ActivityTab } from "./ActivityTab";
import { AgentsTab } from "./AgentsTab";
import { MembersTab } from "./MembersTab";
import { ReviewTab } from "./ReviewTab";
import { StagesTab } from "./StagesTab";

type ProjectRoute = Extract<Route, { name: "project" }>;

const TABS: { key: ProjectRoute["tab"]; label: string; href: (id: string) => string }[] = [
  { key: "stages", label: "Etapas", href: (id) => paths.stage(id) },
  { key: "agents", label: "Agentes", href: paths.agents },
  { key: "members", label: "Miembros", href: paths.members },
  { key: "review", label: "Revisión final", href: paths.review },
  { key: "activity", label: "Actividad", href: paths.activity },
];

export function ProjectPage({ route }: { route: ProjectRoute }) {
  const { data, error, loading, reload } = useLoad(() => client.projects.get(route.id), [route.id]);

  if (error) {
    return (
      <main className="page">
        <p><a href={paths.projects()}>Volver a proyectos</a></p>
        <Notice>{errorText(error)}</Notice>
      </main>
    );
  }
  if (loading && !data) return <main className="page"><Loading /></main>;
  const project = data!.project;

  return (
    <main className="page page-wide">
      <p className="crumb"><a href={paths.projects()}>Proyectos</a></p>
      <div className="project-head">
        <h1>{project.name}</h1>
        <RoleTag role={project.role} />
      </div>

      <nav className="tabs" aria-label="Secciones del proyecto">
        {TABS.map((t) => (
          <a
            key={t.key}
            href={t.href(project.id)}
            className={t.key === route.tab ? "tab active" : "tab"}
            aria-current={t.key === route.tab ? "page" : undefined}
          >
            {t.label}
          </a>
        ))}
      </nav>

      {route.tab === "stages" && (
        <StagesTab project={project} selected={route.stage} onProjectChange={reload} />
      )}
      {route.tab === "agents" && <AgentsTab project={project} />}
      {route.tab === "members" && <MembersTab project={project} onProjectChange={reload} />}
      {route.tab === "review" && <ReviewTab project={project} onProjectChange={reload} />}
      {route.tab === "activity" && <ActivityTab project={project} />}
    </main>
  );
}
