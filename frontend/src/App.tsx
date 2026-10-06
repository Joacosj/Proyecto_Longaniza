import { useEffect, useState } from "react";
import { api } from "./api";

type Health = "cargando" | "ok" | "sin conexión";

export function App() {
  const [backend, setBackend] = useState<Health>("cargando");
  const [db, setDb] = useState<Health>("cargando");

  useEffect(() => {
    api<{ status: string }>("/health")
      .then(() => setBackend("ok"))
      .catch(() => setBackend("sin conexión"));
    api<{ status: string }>("/health/db")
      .then(() => setDb("ok"))
      .catch(() => setDb("sin conexión"));
  }, []);

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", maxWidth: 640, margin: "4rem auto", padding: "0 1rem" }}>
      <h1>Ideator</h1>
      <p>De una idea informal a una especificación que otra IA puede implementar.</p>
      <ul>
        <li>Backend: {backend}</li>
        <li>Base de datos: {db}</li>
      </ul>
    </main>
  );
}
