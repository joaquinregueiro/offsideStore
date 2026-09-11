import { getDatabase, schema, type Database } from '@offside/database';
import { and, eq, isNotNull, sql } from 'drizzle-orm';

/**
 * Acceso a `seller_reputations` (ERD §7.4) y a las agregaciones que la
 * alimentan. Sin reglas de negocio.
 *
 * `seller_reputations` es CACHE DERIVADO (DEC-036): todo lo que se escribe aca
 * se puede volver a calcular desde el historial, las ordenes, las reviews, las
 * disputas y los envios. Por eso el unico write es un upsert completo.
 */

export type SellerReputationRow = typeof schema.sellerReputations.$inferSelect;

const conn = (db?: Database): Database => db ?? getDatabase();

export async function findBySellerId(
  sellerId: string,
  db?: Database,
): Promise<SellerReputationRow | undefined> {
  const [row] = await conn(db)
    .select()
    .from(schema.sellerReputations)
    .where(eq(schema.sellerReputations.sellerId, sellerId))
    .limit(1);

  return row;
}

/** `user_id` del perfil de vendedor: el historial esta indexado por usuario. */
export async function findSellerUserId(
  sellerId: string,
  db?: Database,
): Promise<string | undefined> {
  const [row] = await conn(db)
    .select({ userId: schema.sellerProfiles.userId })
    .from(schema.sellerProfiles)
    .where(eq(schema.sellerProfiles.id, sellerId))
    .limit(1);

  return row?.userId;
}

/** Disputas abiertas alguna vez contra el vendedor, en cualquier estado. */
export async function countDisputes(sellerId: string, db?: Database): Promise<number> {
  const [row] = await conn(db)
    .select({ total: sql<number>`count(*)::int` })
    .from(schema.disputes)
    .where(eq(schema.disputes.sellerId, sellerId));

  return row?.total ?? 0;
}

/** Reembolsos COMPLETADOS sobre ordenes del vendedor. Uno pedido y rechazado no cuenta. */
export async function countCompletedRefunds(sellerId: string, db?: Database): Promise<number> {
  const [row] = await conn(db)
    .select({ total: sql<number>`count(*)::int` })
    .from(schema.refunds)
    .innerJoin(schema.orders, eq(schema.refunds.orderId, schema.orders.id))
    .where(and(eq(schema.orders.sellerId, sellerId), eq(schema.refunds.status, 'COMPLETED')));

  return row?.total ?? 0;
}

/**
 * Promedio de horas entre el cobro (`orders.paid_at`) y el despacho
 * (`shipments.dispatched_at`), sobre los envios que tienen las dos fechas.
 * `null` si el vendedor todavia no despacho nada.
 *
 * Se mide desde `paid_at` y no desde `created_at` porque el plazo de despacho
 * (BR-032) corre desde que hay plata, no desde que alguien apreto comprar.
 */
export async function averageDispatchHours(
  sellerId: string,
  db?: Database,
): Promise<number | null> {
  const [row] = await conn(db)
    .select({
      promedio: sql<
        string | null
      >`avg(extract(epoch from (${schema.shipments.dispatchedAt} - ${schema.orders.paidAt})) / 3600.0)`,
    })
    .from(schema.shipments)
    .innerJoin(schema.orders, eq(schema.shipments.orderId, schema.orders.id))
    .where(
      and(
        eq(schema.orders.sellerId, sellerId),
        isNotNull(schema.shipments.dispatchedAt),
        isNotNull(schema.orders.paidAt),
      ),
    );

  const valor = row?.promedio;
  if (valor === null || valor === undefined) return null;

  const numero = Number(valor);
  return Number.isFinite(numero) ? numero : null;
}

export interface RatingAggregate {
  ratingAvg: number | null;
  ratingCount: number;
}

export async function aggregateRatings(sellerId: string, db?: Database): Promise<RatingAggregate> {
  const [row] = await conn(db)
    .select({
      promedio: sql<string | null>`avg(${schema.reviews.rating})`,
      total: sql<number>`count(*)::int`,
    })
    .from(schema.reviews)
    .where(eq(schema.reviews.sellerId, sellerId));

  const total = row?.total ?? 0;
  const promedio = row?.promedio;

  return {
    ratingAvg: total > 0 && promedio !== null && promedio !== undefined ? Number(promedio) : null,
    ratingCount: total,
  };
}

export interface ReputationUpsert {
  sellerId: string;
  salesCount: number;
  cancellationsCount: number;
  claimsCount: number;
  refundsCount: number;
  /** `numeric` viaja como string. */
  avgDispatchHours: string | null;
  ratingAvg: string | null;
  ratingCount: number;
  score: string | null;
  computedAt: Date;
}

/**
 * Escribe la proyeccion completa.
 *
 * ⚠️ `counterfeit_flags` NO se toca: TS-022 dice que las falsificaciones
 * confirmadas pesan "desproporcionadamente", pero como se confirman y con que
 * payload sigue 🟡. Hasta que exista ese hecho, el recompute no lo pisa.
 */
export async function upsert(values: ReputationUpsert, db?: Database): Promise<void> {
  const { sellerId, ...resto } = values;

  await conn(db)
    .insert(schema.sellerReputations)
    .values({ sellerId, ...resto })
    .onConflictDoUpdate({ target: schema.sellerReputations.sellerId, set: resto });
}

/* -------------------------------------------------------------------------- */
/* Agregados en la segunda ola (service de reputacion)                         */
/* -------------------------------------------------------------------------- */

export interface SellerUserRef {
  sellerId: string;
  userId: string;
  /** Nombre de tienda, para la etiqueta de la ficha. */
  sellerDisplayName: string;
  userLevel: (typeof schema.userLevel.enumValues)[number];
  riskLevel: (typeof schema.riskLevel.enumValues)[number];
}

/**
 * El usuario detras del perfil de vendedor, con su nivel y su riesgo. TS-021
 * pide mostrar los tres ejes juntos y son de tablas distintas.
 */
export async function findSellerUser(
  sellerId: string,
  db?: Database,
): Promise<SellerUserRef | undefined> {
  const [row] = await conn(db)
    .select({
      sellerId: schema.sellerProfiles.id,
      userId: schema.sellerProfiles.userId,
      sellerDisplayName: schema.sellerProfiles.displayName,
      userLevel: schema.users.userLevel,
      riskLevel: schema.users.riskLevel,
    })
    .from(schema.sellerProfiles)
    .innerJoin(schema.users, eq(schema.sellerProfiles.userId, schema.users.id))
    .where(eq(schema.sellerProfiles.id, sellerId))
    .limit(1);

  return row;
}

/** `seller_profiles.id` de un usuario, o `undefined` si no es vendedor. */
export async function findSellerIdByUserId(
  userId: string,
  db?: Database,
): Promise<string | undefined> {
  const [row] = await conn(db)
    .select({ id: schema.sellerProfiles.id })
    .from(schema.sellerProfiles)
    .where(eq(schema.sellerProfiles.userId, userId))
    .limit(1);

  return row?.id;
}

export interface DispatchTimeliness {
  /** Envios con `dispatched_at` y `paid_at`: los que se pueden juzgar. */
  measured: number;
  /** De esos, cuantos salieron dentro del plazo. */
  onTime: number;
}

/**
 * Cuantos despachos salieron dentro de `deadlineHours` desde el pago.
 *
 * ⚠️ NO SE PERSISTE: `seller_reputations` (ERD §7.4) no tiene columna para
 * la tasa de puntualidad, solo `avg_dispatch_hours`. Se calcula y se devuelve.
 * El plazo se recibe por parametro para juzgar con el mismo valor que rige
 * (BR-032), no con uno propio.
 */
export async function dispatchTimeliness(
  sellerId: string,
  deadlineHours: number,
  db?: Database,
): Promise<DispatchTimeliness> {
  const [row] = await conn(db)
    .select({
      measured: sql<number>`count(*)::int`,
      onTime: sql<number>`coalesce(sum(case when ${schema.shipments.dispatchedAt} <= ${schema.orders.paidAt} + (${deadlineHours}::numeric * interval '1 hour') then 1 else 0 end), 0)::int`,
    })
    .from(schema.shipments)
    .innerJoin(schema.orders, eq(schema.shipments.orderId, schema.orders.id))
    .where(
      and(
        eq(schema.orders.sellerId, sellerId),
        isNotNull(schema.shipments.dispatchedAt),
        isNotNull(schema.orders.paidAt),
      ),
    );

  return { measured: row?.measured ?? 0, onTime: row?.onTime ?? 0 };
}
