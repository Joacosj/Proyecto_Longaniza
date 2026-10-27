/**
 * Base de datos para pruebas. Cada archivo de prueba crea un esquema propio y temporal
 * (test_<aleatorio>), aplica las migraciones ahí y lo borra al terminar. Así no toca los
 * datos de desarrollo y los archivos pueden correr sin pisarse.
 *
 * Usa TEST_DATABASE_URL, o DATABASE_URL, o la base local de docker compose.
 * Requiere la base arriba: `docker compose up db`.
 */
import postgres from "postgres";
import type { Sql } from "../../src/db/client.ts";
import { migrate } from "../../src/db/migrate.ts";

const DEFAULT_URL = "postgres://ideator:ideator@localhost:5432/ideator";

export interface TestDb {
  sql: Sql;
  close: () => Promise<void>;
}

export async function createTestDb(): Promise<TestDb> {
  const url = Deno.env.get("TEST_DATABASE_URL") ?? Deno.env.get("DATABASE_URL") ?? DEFAULT_URL;
  const schema = `test_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;

  const admin = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await admin.unsafe(`CREATE SCHEMA ${schema}`);
  } catch (err) {
    await admin.end();
    throw new Error(
      `No se pudo conectar a la base de pruebas (${url}). ¿Está arriba? docker compose up db\n${err}`,
    );
  }

  // public queda en el search_path para encontrar gen_random_uuid y extensiones.
  const sql = postgres(url, {
    max: 5,
    onnotice: () => {},
    connection: { search_path: `${schema},public` },
  });
  await migrate(sql);

  return {
    sql,
    close: async () => {
      await sql.end();
      await admin.unsafe(`DROP SCHEMA ${schema} CASCADE`);
      await admin.end();
    },
  };
}
