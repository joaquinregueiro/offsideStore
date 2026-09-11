import { getDatabase, schema, type Database } from '@offside/database';
import { and, desc, eq, inArray, isNotNull, lte } from 'drizzle-orm';

/** Acceso a `sanctions` (ERD §16.2). Sin reglas de negocio. */

export type SanctionRow = typeof schema.sanctions.$inferSelect;
export type SanctionType = (typeof schema.sanctions.type.enumValues)[number];

/**
 * Estados de una sancion. El ERD §16.2 los fija como `text`
 * (`active` / `lifted` / `expired`), no como enum.
 */
export type SanctionStatus = 'active' | 'lifted' | 'expired';

const conn = (db?: Database): Database => db ?? getDatabase();

export async function findById(id: string, db?: Database): Promise<SanctionRow | undefined> {
  const [row] = await conn(db)
    .select()
    .from(schema.sanctions)
    .where(eq(schema.sanctions.id, id))
    .limit(1);

  return row;
}

/** Todas las sanciones de un vendedor, de la mas nueva a la mas vieja. */
export async function findBySellerId(sellerId: string, db?: Database): Promise<SanctionRow[]> {
  return conn(db)
    .select()
    .from(schema.sanctions)
    .where(eq(schema.sanctions.sellerId, sellerId))
    .orderBy(desc(schema.sanctions.createdAt));
}

/**
 * Sanciones en estado `active` de un vendedor.
 *
 * ⚠️ `active` EN LA COLUMNA NO SIGNIFICA VIGENTE: una sancion con `ends_at` ya
 * pasado sigue `active` hasta que un barrido la marque `expired`. Quien decide
 * si rige es `sanction-rules.ts`, que ademas mira la fecha.
 */
export async function findActiveBySellerId(
  sellerId: string,
  db?: Database,
): Promise<SanctionRow[]> {
  return conn(db)
    .select()
    .from(schema.sanctions)
    .where(and(eq(schema.sanctions.sellerId, sellerId), eq(schema.sanctions.status, 'active')))
    .orderBy(desc(schema.sanctions.createdAt));
}

export interface InsertSanctionValues {
  sellerId: string;
  type: SanctionType;
  reason: string | null;
  disputeId: string | null;
  limitations: unknown;
  appliedBy: string | null;
  startsAt: Date;
  endsAt: Date | null;
}

export async function insertActive(
  values: InsertSanctionValues,
  db?: Database,
): Promise<SanctionRow> {
  const [row] = await conn(db)
    .insert(schema.sanctions)
    .values({
      sellerId: values.sellerId,
      type: values.type,
      reason: values.reason,
      disputeId: values.disputeId,
      limitations: values.limitations ?? null,
      appliedBy: values.appliedBy,
      startsAt: values.startsAt,
      endsAt: values.endsAt,
      status: 'active',
    })
    .returning();

  return row!;
}

/**
 * Pasa una sancion de `active` a otro estado.
 *
 * ⚠️ CONDICIONAL: la condicion `status = 'active'` va en el WHERE, no en un
 * `if` previo. Dos administradores levantando la misma sancion a la vez no
 * pueden "levantarla" dos veces: el segundo recibe `undefined`.
 */
export async function transitionFromActive(
  id: string,
  to: Exclude<SanctionStatus, 'active'>,
  db?: Database,
): Promise<SanctionRow | undefined> {
  const [row] = await conn(db)
    .update(schema.sanctions)
    .set({ status: to })
    .where(and(eq(schema.sanctions.id, id), eq(schema.sanctions.status, 'active')))
    .returning();

  return row;
}

/**
 * Sanciones `active` cuyo `ends_at` ya paso. Candidatas a `expired`.
 *
 * Solo las que TIENEN vencimiento: una sancion sin `ends_at` no vence nunca.
 */
export async function findActiveEndedBefore(
  now: Date,
  limit: number,
  db?: Database,
): Promise<SanctionRow[]> {
  return conn(db)
    .select()
    .from(schema.sanctions)
    .where(
      and(
        eq(schema.sanctions.status, 'active'),
        isNotNull(schema.sanctions.endsAt),
        lte(schema.sanctions.endsAt, now),
      ),
    )
    .orderBy(desc(schema.sanctions.endsAt))
    .limit(limit);
}

/** Marca `expired` un lote de sanciones que siguen `active`. Para un barrido. */
export async function expireMany(ids: string[], db?: Database): Promise<SanctionRow[]> {
  if (ids.length === 0) return [];

  return conn(db)
    .update(schema.sanctions)
    .set({ status: 'expired' })
    .where(and(inArray(schema.sanctions.id, ids), eq(schema.sanctions.status, 'active')))
    .returning();
}
