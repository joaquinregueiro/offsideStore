import { getDatabase, schema, type Database } from '@offside/database';
import { and, desc, eq } from 'drizzle-orm';

/**
 * Lectura y escritura de `users.user_level` (ERD §5.1) y de su auditoria
 * `user_level_history` (ERD §6.4). Sin reglas de negocio.
 *
 * ⚠️ POR QUE ESTE MODULO ESCRIBE UNA COLUMNA DE `users`: el nivel es un
 * DERIVADO del historial (DEC-020 / DEC-036) y este modulo es el que lo
 * proyecta; `users` no tiene Service para esto y un modulo no importa el
 * Repository de otro (`modules/README.md`). Es la unica columna de `users`
 * que se toca desde aca, y solo a traves de `updateUserLevel`.
 */

export type UserLevel = (typeof schema.userLevel.enumValues)[number];
export type UserLevelHistoryRow = typeof schema.userLevelHistory.$inferSelect;

const conn = (db?: Database): Database => db ?? getDatabase();

export interface UserLevelRef {
  id: string;
  userLevel: UserLevel;
  status: (typeof schema.userStatus.enumValues)[number];
}

export async function findUserLevel(
  userId: string,
  db?: Database,
): Promise<UserLevelRef | undefined> {
  const [row] = await conn(db)
    .select({
      id: schema.users.id,
      userLevel: schema.users.userLevel,
      status: schema.users.status,
    })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);

  return row;
}

/**
 * Cambia el nivel SOLO si el usuario todavia esta en `from`. Devuelve `true`
 * si escribio: dos evaluaciones simultaneas (dos ordenes completadas a la
 * vez) no pueden pisar la misma transicion ni duplicar su historial.
 */
export async function updateUserLevel(
  userId: string,
  from: UserLevel,
  to: UserLevel,
  db?: Database,
): Promise<boolean> {
  if (from === to) return false;

  const rows = await conn(db)
    .update(schema.users)
    .set({ userLevel: to, updatedAt: new Date() })
    .where(and(eq(schema.users.id, userId), eq(schema.users.userLevel, from)))
    .returning({ id: schema.users.id });

  return rows.length > 0;
}

export interface LevelHistoryInsert {
  userId: string;
  fromValue: UserLevel | null;
  toValue: UserLevel;
  reason: string | null;
  triggeredBy: 'system' | 'admin';
  adminId: string | null;
}

export async function insertLevelHistory(
  values: LevelHistoryInsert,
  db?: Database,
): Promise<UserLevelHistoryRow> {
  const [row] = await conn(db).insert(schema.userLevelHistory).values(values).returning();

  if (row === undefined) {
    throw new Error('user_level_history: el INSERT no devolvio la fila');
  }

  return row;
}

/** Transiciones de nivel, la mas reciente primero. Para el perfil y los tests. */
export async function findLevelHistory(
  userId: string,
  limite = 20,
  db?: Database,
): Promise<UserLevelHistoryRow[]> {
  return conn(db)
    .select()
    .from(schema.userLevelHistory)
    .where(eq(schema.userLevelHistory.userId, userId))
    .orderBy(desc(schema.userLevelHistory.createdAt), desc(schema.userLevelHistory.id))
    .limit(limite);
}
