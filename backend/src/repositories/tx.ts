import type { Sql } from "../db/client.ts";

/**
 * Ejecuta `fn` en una transacción. Si `fn` lanza (incluido un ApiError), se revierte todo.
 * El objeto de transacción se pasa como `Sql` para reutilizar los mismos repositorios.
 */
export function inTransaction<T>(sql: Sql, fn: (tx: Sql) => Promise<T>): Promise<T> {
  return sql.begin((tx) => fn(tx as unknown as Sql)) as Promise<T>;
}
