import { getDatabase, schema, type Database } from '@offside/database';
import { and, eq, gt, isNull } from 'drizzle-orm';

/**
 * Acceso a `email_verification_tokens` y `password_reset_tokens` (ERD §5.4/§5.5).
 *
 * Ambas tablas tienen exactamente la misma forma, asi que comparten helpers
 * parametrizados por tabla en lugar de duplicar el codigo.
 */

type TokenTable = typeof schema.emailVerificationTokens | typeof schema.passwordResetTokens;

const conn = (db?: Database): Database => db ?? getDatabase();

async function insertToken(
  table: TokenTable,
  values: { userId: string; tokenHash: string; expiresAt: Date },
  db?: Database,
): Promise<void> {
  await conn(db).insert(table).values(values);
}

/** Devuelve el token solo si no expiro y no fue consumido. */
async function findUsable(
  table: TokenTable,
  tokenHash: string,
  db?: Database,
): Promise<{ id: string; userId: string } | undefined> {
  const [row] = await conn(db)
    .select({ id: table.id, userId: table.userId })
    .from(table)
    .where(
      and(
        eq(table.tokenHash, tokenHash),
        isNull(table.consumedAt),
        gt(table.expiresAt, new Date()),
      ),
    )
    .limit(1);

  return row;
}

/**
 * Marca el token como consumido.
 *
 * Devuelve `false` si ya estaba consumido. La condicion `consumed_at IS NULL`
 * va en el UPDATE, no en una lectura previa: asi es ATOMICO y dos requests
 * simultaneos no pueden consumir el mismo token.
 */
async function consume(table: TokenTable, id: string, db?: Database): Promise<boolean> {
  const updated = await conn(db)
    .update(table)
    .set({ consumedAt: new Date() })
    .where(and(eq(table.id, id), isNull(table.consumedAt)))
    .returning({ id: table.id });

  return updated.length === 1;
}

export const emailVerificationTokens = {
  insert: (v: { userId: string; tokenHash: string; expiresAt: Date }, db?: Database) =>
    insertToken(schema.emailVerificationTokens, v, db),
  findUsable: (tokenHash: string, db?: Database) =>
    findUsable(schema.emailVerificationTokens, tokenHash, db),
  consume: (id: string, db?: Database) => consume(schema.emailVerificationTokens, id, db),
};

export const passwordResetTokens = {
  insert: (v: { userId: string; tokenHash: string; expiresAt: Date }, db?: Database) =>
    insertToken(schema.passwordResetTokens, v, db),
  findUsable: (tokenHash: string, db?: Database) =>
    findUsable(schema.passwordResetTokens, tokenHash, db),
  consume: (id: string, db?: Database) => consume(schema.passwordResetTokens, id, db),
};
