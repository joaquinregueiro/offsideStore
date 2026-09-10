import { getDatabase, schema, type Database } from '@offside/database';
import { and, eq, isNull } from 'drizzle-orm';

/**
 * Acceso a datos de `users`. SIN reglas de negocio (CLAUDE.md §8):
 * no decide si un usuario puede operar, solo lee y escribe.
 *
 * Todas las funciones aceptan un `db` opcional para poder participar de una
 * transaccion abierta por el Service.
 */

export type UserRow = typeof schema.users.$inferSelect;

const conn = (db?: Database): Database => db ?? getDatabase();

/**
 * Busca por email.
 *
 * No hace falta normalizar el case: `users.email` es `citext` (ERD §5.1), asi
 * que PostgreSQL compara sin distinguir mayusculas.
 *
 * Excluye borrados logicos (`deleted_at`), coherente con el soft delete del
 * ERD §20.10.
 */
export async function findByEmail(email: string, db?: Database): Promise<UserRow | undefined> {
  const [row] = await conn(db)
    .select()
    .from(schema.users)
    .where(and(eq(schema.users.email, email), isNull(schema.users.deletedAt)))
    .limit(1);

  return row;
}

export async function findById(id: string, db?: Database): Promise<UserRow | undefined> {
  const [row] = await conn(db)
    .select()
    .from(schema.users)
    .where(and(eq(schema.users.id, id), isNull(schema.users.deletedAt)))
    .limit(1);

  return row;
}

export async function insertUser(
  values: { email: string; passwordHash: string; displayName?: string | undefined },
  db?: Database,
): Promise<UserRow> {
  const [row] = await conn(db)
    .insert(schema.users)
    .values({
      email: values.email,
      passwordHash: values.passwordHash,
      ...(values.displayName === undefined ? {} : { displayName: values.displayName }),
    })
    .returning();

  // `returning()` sobre un insert de una fila siempre devuelve una.
  return row!;
}

export async function markEmailVerified(userId: string, db?: Database): Promise<void> {
  await conn(db)
    .update(schema.users)
    .set({ emailVerifiedAt: new Date(), updatedAt: new Date() })
    .where(eq(schema.users.id, userId));
}

export async function updatePasswordHash(
  userId: string,
  passwordHash: string,
  db?: Database,
): Promise<void> {
  await conn(db)
    .update(schema.users)
    .set({ passwordHash, updatedAt: new Date() })
    .where(eq(schema.users.id, userId));
}
