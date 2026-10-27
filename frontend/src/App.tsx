import { useEffect } from "react";
import { AuthProvider, useAuth } from "./auth";
import { AuthPagesRedirect } from "./pages/AuthRedirect";
import { InvitationPage } from "./pages/InvitationPage";
import { ProjectPage } from "./pages/ProjectPage";
import { ProjectsPage } from "./pages/ProjectsPage";
import { navigate, paths, useRoute } from "./router";
import { Loading } from "./ui";

export function App() {
  return (
    <AuthProvider>
      <Shell />
    </AuthProvider>
  );
}

function Shell() {
  const { user, logout } = useAuth();
  const route = useRoute();
  const isPublic = route.name === "login" || route.name === "register" || route.name === "invitation";

  // Sin sesión, las rutas privadas llevan al login y vuelven después.
  useEffect(() => {
    if (user === null && !isPublic) navigate(paths.login(location.hash || undefined));
  }, [user, isPublic]);

  if (user === undefined) return <main className="page"><Loading /></main>;

  return (
    <>
      <a className="skip" href="#contenido">Saltar al contenido</a>
      {user && (
        <header className="topbar">
          <a href={paths.projects()} className="wordmark">Ideator</a>
          <div className="row">
            <span className="muted">{user.name}</span>
            <button
              type="button"
              className="link"
              onClick={async () => {
                await logout();
                navigate(paths.login());
              }}
            >
              Cerrar sesión
            </button>
          </div>
        </header>
      )}
      <div id="contenido">
        {route.name === "login" || route.name === "register"
          ? <AuthPagesRedirect route={route} />
          : route.name === "invitation"
          ? <InvitationPage token={route.token} />
          : !user
          ? null
          : route.name === "projects"
          ? <ProjectsPage />
          : route.name === "project"
          ? <ProjectPage route={route} />
          : (
            <main className="page">
              <h1>Página no encontrada</h1>
              <p><a href={paths.projects()}>Ir a tus proyectos</a></p>
            </main>
          )}
      </div>
    </>
  );
}
