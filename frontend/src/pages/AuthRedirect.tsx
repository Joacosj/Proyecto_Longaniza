import { useEffect } from "react";
import { useAuth } from "../auth";
import { navigate, paths, type Route } from "../router";
import { LoginPage, RegisterPage } from "./AuthPages";

/** Login y registro; si ya hay sesión, salta al destino. */
export function AuthPagesRedirect({ route }: { route: Extract<Route, { name: "login" | "register" }> }) {
  const { user } = useAuth();
  useEffect(() => {
    if (user) navigate(route.next ?? paths.projects());
  }, [user, route.next]);
  if (user) return null;
  return route.name === "login" ? <LoginPage next={route.next} ssoError={route.error} /> : <RegisterPage next={route.next} />;
}
