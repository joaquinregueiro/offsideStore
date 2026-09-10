import { getDatabase, schema, type Database } from '@offside/database';
import { and, eq, gt, lt } from 'drizzle-orm';

/** Acceso a datos de `sessions` (ERD §5.2). Sin reglas de negocio. */

export type SessionRow = typeof schema.sessions.$inferSelect;

const conn = (db?: Database): Database => db ?? getDatabase();

export async function insertSession(
  values: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
    userAgent?: string | undefined;
    ip?: string | undefined;
  },
  db?: Database,
): Promise<SessionRow> {
  const [row] = await conn(db)
    .insert(schema.sessions)
    .values({
      userId: values.userId,
      tokenHash: values.tokenHash,
      expiresAt: values.expiresAt,
      ...(values.userAgent === undefined ? {} : { userAgent: values.userAgent }),
      ...(values.ip === undefined ? {} : { ip: values.ip }),
    })
    .returning();

  return row!;
}

/** Devuelve la sesion solo si NO expiro. El filtro va en SQL, no en memoria. */
export async function findValidByTokenHash(
  tokenHash: string,
  db?: Database,
): Promise<SessionRow | undefined> {
  const [row] = await conn(db)
    .select()
    .from(schema.sessions)
    .where(and(eq(schema.sessions.tokenHash, tokenHash), gt(schema.sessions.expiresAt, new Date())))
    .limit(1);

  return row;
}

/**
 * Borra la sesion. Hard delete a proposito: el ERD §20.10 dice que las
 * entidades efimeras (sesiones, tokens) SI se borran.
 */
export async function deleteByTokenHash(tokenHash: string, db?: Database): Promise<number> {
  const deleted = await conn(db)
    .delete(schema.sessions)
    .where(eq(schema.sessions.tokenHash, tokenHash))
    .returning({ id: schema.sessions.id });

  return deleted.length;
}

/** Cierra todas las sesiones del usuario (cambio de password, sancion). */
export async function deleteAllForUser(userId: string, db?: Database): Promise<number> {
  const deleted = await conn(db)
    .delete(schema.sessions)
    .where(eq(schema.sessions.userId, userId))
    .returning({ id: schema.sessions.id });

  return deleted.length;
}

/** Limpieza de sesiones vencidas. Pensada para un job periodico. */
export async function deleteExpired(db?: Database): Promise<number> {
  const deleted = await conn(db)
    .delete(schema.sessions)
    .where(lt(schema.sessions.expiresAt, new Date()))
    .returning({ id: schema.sessions.id });

  return deleted.length;
}
