import type { Sql } from "../db/client.ts";

/** Usuario tal como se expone en la API (nunca incluye el hash). */
export interface PublicUser {
  id: string;
  email: string;
  name: string;
}

export interface UserWithPassword extends PublicUser {
  passwordHash: string | null;
}

export class EmailTakenError extends Error {
  constructor() {
    super("El correo ya está registrado");
  }
}

/** Código de PostgreSQL para violación de índice único. */
const UNIQUE_VIOLATION = "23505";

export function usersRepo(sql: Sql) {
  return {
    async create(input: { email: string; name: string; passwordHash: string | null }) {
      try {
        const [row] = await sql<PublicUser[]>`
          INSERT INTO users (email, name, password_hash)
          VALUES (${input.email}, ${input.name}, ${input.passwordHash})
          RETURNING id, email, name`;
        return row;
      } catch (err) {
        if ((err as { code?: string }).code === UNIQUE_VIOLATION) throw new EmailTakenError();
        throw err;
      }
    },

    async findByEmail(email: string): Promise<UserWithPassword | undefined> {
      const [row] = await sql<UserWithPassword[]>`
        SELECT id, email, name, password_hash AS "passwordHash"
        FROM users WHERE lower(email) = lower(${email})`;
      return row;
    },

    async findById(id: string): Promise<PublicUser | undefined> {
      const [row] = await sql<PublicUser[]>`SELECT id, email, name FROM users WHERE id = ${id}`;
      return row;
    },
  };
}
