import { getDatabase, schema, type Database } from '@offside/database';
import { and, desc, eq, gt, inArray, lte, notInArray, sql } from 'drizzle-orm';

/**
 * Acceso a `listing_promotions` (delta al ERD del 2026-09-10 §9) y a la
 * proyeccion `listings.promoted_until` / `promoted_at`. Sin reglas de negocio.
 *
 * ⚠️ HISTORIAL Y PROYECCION SE ESCRIBEN JUNTOS. La tabla es la evidencia —una
 * fila por cada vez que se promociono algo— y `promoted_until` es la copia
 * rapida que leen la vitrina y la busqueda. Quien llama pasa la MISMA
 * transaccion a `insertPromotion` y a `projectPromotedUntil`; si difieren,
 * manda el historial.
 */

export type PromotionRow = typeof schema.listingPromotions.$inferSelect;

const conn = (db?: Database): Database => db ?? getDatabase();

export interface InsertPromotionValues {
  listingId: string;
  sellerId: string;
  /** Ya en escala `numeric(6,3)`: `'3.000'`. */
  commissionMultiplierSnapshot: string;
  startsAt: Date;
  endsAt: Date;
  createdBy: string;
}

export async function insertPromotion(
  values: InsertPromotionValues,
  db?: Database,
): Promise<PromotionRow> {
  const [row] = await conn(db)
    .insert(schema.listingPromotions)
    .values({ ...values, status: 'active' })
    .returning();

  return row!;
}

/**
 * La promocion VIGENTE de una publicacion en el instante `at`, si hay una.
 *
 * ⚠️ MIRA `ends_at`, NO SOLO `status`. El barrido que pasa `active` → `ended`
 * puede no haber corrido todavia, y una promocion vencida hace cinco minutos
 * no puede seguir agravando la comision de una orden que se crea ahora.
 */
export async function findActiveByListingId(
  listingId: string,
  at: Date = new Date(),
  db?: Database,
): Promise<PromotionRow | undefined> {
  const [row] = await conn(db)
    .select()
    .from(schema.listingPromotions)
    .where(
      and(
        eq(schema.listingPromotions.listingId, listingId),
        eq(schema.listingPromotions.status, 'active'),
        lte(schema.listingPromotions.startsAt, at),
        gt(schema.listingPromotions.endsAt, at),
      ),
    )
    .orderBy(desc(schema.listingPromotions.startsAt))
    .limit(1);

  return row;
}

export async function findById(id: string, db?: Database): Promise<PromotionRow | undefined> {
  const [row] = await conn(db)
    .select()
    .from(schema.listingPromotions)
    .where(eq(schema.listingPromotions.id, id))
    .limit(1);

  return row;
}

/** Historial de un vendedor, de la mas nueva a la mas vieja. */
export async function findBySellerId(
  sellerId: string,
  limite = 50,
  db?: Database,
): Promise<PromotionRow[]> {
  return conn(db)
    .select()
    .from(schema.listingPromotions)
    .where(eq(schema.listingPromotions.sellerId, sellerId))
    .orderBy(desc(schema.listingPromotions.startsAt), desc(schema.listingPromotions.createdAt))
    .limit(limite);
}

/**
 * Cancela una promocion. La condicion `status = 'active'` va en el WHERE para
 * que dos cancelaciones simultaneas no escriban dos `cancelled_at` distintos:
 * gana una y la otra no encuentra fila.
 */
export async function cancel(id: string, at: Date, db?: Database): Promise<boolean> {
  const filas = await conn(db)
    .update(schema.listingPromotions)
    .set({ status: 'cancelled', cancelledAt: at })
    .where(and(eq(schema.listingPromotions.id, id), eq(schema.listingPromotions.status, 'active')))
    .returning({ id: schema.listingPromotions.id });

  return filas.length === 1;
}

/**
 * Pasa a `ended` las promociones cuyo `ends_at` ya paso. Devuelve cuantas.
 *
 * Es el barrido del que habla el delta §9: lo marca un job, no una persona.
 * No toca `listings.promoted_until` —ya no cuenta, porque el predicado es
 * `now() < promoted_until`— y asi la columna queda como evidencia.
 */
export async function endExpired(at: Date = new Date(), db?: Database): Promise<number> {
  const filas = await conn(db)
    .update(schema.listingPromotions)
    .set({ status: 'ended' })
    .where(
      and(eq(schema.listingPromotions.status, 'active'), lte(schema.listingPromotions.endsAt, at)),
    )
    .returning({ id: schema.listingPromotions.id });

  return filas.length;
}

/**
 * Proyecta la promocion sobre la publicacion: `promoted_until` es lo que leen
 * la vitrina y la busqueda; `promoted_at` es solo trazabilidad.
 */
export async function projectPromotedUntil(
  listingId: string,
  promotedUntil: Date | null,
  promotedAt: Date | null,
  db?: Database,
): Promise<void> {
  await conn(db)
    .update(schema.listings)
    .set({
      promotedUntil,
      ...(promotedAt === null ? {} : { promotedAt }),
      updatedAt: sql`now()`,
    })
    .where(eq(schema.listings.id, listingId));
}

/**
 * Cuantas VENTAS se hicieron bajo cada promocion, via
 * `orders.listing_promotion_id` (delta §10).
 *
 * ⚠️ "Venta" = orden que llego a pagarse: se excluyen `PENDING_PAYMENT` (una
 * orden armada y abandonada no es una venta) y `CANCELLED`. Se cuenta cada
 * orden, no cada unidad: es lo que el vendedor lee como "cuantas veces se
 * vendio con la promocion". Las que despues se reembolsaron SIGUEN contando
 * aca —la promocion se cobro igual—; para tiers y reputacion rige BR-051,
 * que es otro conteo.
 */
export async function countSalesByPromotionIds(
  promotionIds: string[],
  db?: Database,
): Promise<Map<string, number>> {
  if (promotionIds.length === 0) return new Map();

  const filas = await conn(db)
    .select({
      promotionId: schema.orders.listingPromotionId,
      cantidad: sql<number>`count(*)::int`,
    })
    .from(schema.orders)
    .where(
      and(
        inArray(schema.orders.listingPromotionId, promotionIds),
        notInArray(schema.orders.status, ['PENDING_PAYMENT', 'CANCELLED']),
      ),
    )
    .groupBy(schema.orders.listingPromotionId);

  return new Map(
    filas.flatMap((fila) =>
      fila.promotionId === null ? [] : [[fila.promotionId, Number(fila.cantidad)] as const],
    ),
  );
}
