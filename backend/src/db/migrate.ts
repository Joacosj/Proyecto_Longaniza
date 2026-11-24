/**
 * Ejecuta en orden los archivos .sql de ./migrations que aún no se han aplicado.
 * Uso: deno task migrate
 */
import { loadConfig } from "../config.ts";
import { createSql, type Sql } from "./client.ts";

const MIGRATIONS_DIR = new URL("./migrations/", import.meta.url);

export async function migrate(sql: Sql): Promise<string[]> {
  await sql`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`;

  const applied = new Set(
    (await sql<{ name: string }[]>`SELECT name FROM schema_migrations`).map((r) => r.name),
  );

  const files: string[] = [];
  for await (const entry of Deno.readDir(MIGRATIONS_DIR)) {
    if (entry.isFile && entry.name.endsWith(".sql")) files.push(entry.name);
  }
  files.sort();

  const ran: string[] = [];
  for (const name of files) {
    if (applied.has(name)) continue;
    const content = await Deno.readTextFile(new URL(name, MIGRATIONS_DIR));
    await sql.begin(async (tx) => {
      await tx.unsafe(content);
      await tx`INSERT INTO schema_migrations (name) VALUES (${name})`;
    });
    ran.push(name);
  }
  return ran;
}

if (import.meta.main) {
  const config = loadConfig();
  const sql = createSql(config.databaseUrl, config.dbSocketDir);
  try {
    const ran = await migrate(sql);
    console.log(
      ran.length ? `Migraciones aplicadas: ${ran.join(", ")}` : "Sin migraciones pendientes",
    );
  } finally {
    await sql.end();
  }
}
