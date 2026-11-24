import postgres from "postgres";

export type Sql = ReturnType<typeof postgres>;

/**
 * Conexión a PostgreSQL. `socketDir` conecta por socket Unix en vez de TCP: es como Cloud Run
 * llega a Cloud SQL (/cloudsql/<proyecto>:<región>:<instancia>).
 */
export function createSql(databaseUrl: string, socketDir?: string): Sql {
  return postgres(databaseUrl, {
    max: 10,
    onnotice: () => {},
    ...(socketDir ? { host: socketDir } : {}),
  });
}
