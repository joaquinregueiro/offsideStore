import { getDatabase, schema, type Database } from '@offside/database';
import { and, asc, count, desc, eq, inArray, lt, ne } from 'drizzle-orm';

/**
 * Acceso a `disputes`, `dispute_evidences` y `dispute_actions` (ERD §14).
 * Sin reglas de negocio.
 *
 * ⚠️ LEE `orders`, `users` Y `seller_profiles` POR SQL, y es a proposito: un
 * modulo no importa el Repository de otro (`modules/README.md`), y lo que se
 * necesita de esas tablas —el numero de orden para una lista, el email de las
 * partes para avisar, el usuario detras de un vendedor para autorizar— no lo
 * expone hoy ningun Service sin caer en N+1. Es el mismo precedente de `orders`
 * (que lee `disputes` para BR-033) y de `trust` (que lee `seller_profiles`).
 * Cuando esos modulos expongan la lectura, esto se reemplaza.
 */

export type DisputeRow = typeof schema.disputes.$inferSelect;
export type DisputeEvidenceRow = typeof schema.disputeEvidences.$inferSelect;
export type DisputeActionRow = typeof schema.disputeActions.$inferSelect;

export type DisputeStatus = (typeof schema.disputes.status.enumValues)[number];
export type DisputeReason = (typeof schema.disputes.reason.enumValues)[number];
export type DisputeResolution = (typeof schema.disputes.resolution.enumValues)[number];
export type EvidenceUploader = (typeof schema.disputeEvidences.uploadedBy.enumValues)[number];

export const DISPUTE_STATUSES = schema.disputes.status.enumValues;
export const DISPUTE_REASONS = schema.disputes.reason.enumValues;
export const DISPUTE_RESOLUTIONS = schema.disputes.resolution.enumValues;

const conn = (db?: Database): Database => db ?? getDatabase();

/** Una disputa con lo minimo de la orden que una lista necesita mostrar. */
export interface DisputeWithOrder extends DisputeRow {
  orderNumber: string;
  orderTotalAmount: bigint;
}

const CON_ORDEN = {
  id: schema.disputes.id,
  orderId: schema.disputes.orderId,
  buyerId: schema.disputes.buyerId,
  sellerId: schema.disputes.sellerId,
  reason: schema.disputes.reason,
  status: schema.disputes.status,
  resolution: schema.disputes.resolution,
  refundedAmount: schema.disputes.refundedAmount,
  currency: schema.disputes.currency,
  openedAt: schema.disputes.openedAt,
  sellerResponseDueAt: schema.disputes.sellerResponseDueAt,
  sellerRespondedAt: schema.disputes.sellerRespondedAt,
  resolvedAt: schema.disputes.resolvedAt,
  createdAt: schema.disputes.createdAt,
  orderNumber: schema.orders.orderNumber,
  orderTotalAmount: schema.orders.totalAmount,
} as const;

export async function findById(id: string, db?: Database): Promise<DisputeRow | undefined> {
  const [row] = await conn(db)
    .select()
    .from(schema.disputes)
    .where(eq(schema.disputes.id, id))
    .limit(1);

  return row;
}

export async function findByIdWithOrder(
  id: string,
  db?: Database,
): Promise<DisputeWithOrder | undefined> {
  const [row] = await conn(db)
    .select(CON_ORDEN)
    .from(schema.disputes)
    .innerJoin(schema.orders, eq(schema.orders.id, schema.disputes.orderId))
    .where(eq(schema.disputes.id, id))
    .limit(1);

  return row;
}

/** La disputa de una orden, en cualquier estado. `UNIQUE(order_id)`: hay una o ninguna. */
export async function findByOrderId(
  orderId: string,
  db?: Database,
): Promise<DisputeRow | undefined> {
  const [row] = await conn(db)
    .select()
    .from(schema.disputes)
    .where(eq(schema.disputes.orderId, orderId))
    .limit(1);

  return row;
}

/**
 * Hay una disputa NO resuelta sobre la orden.
 *
 * Es el predicado que `orders` necesita para no cerrar una orden con reclamo
 * abierto (BR-033). Mismo WHERE que `order.repository.hasOpenDispute`, para
 * que los dos digan lo mismo hasta que `orders` llame a este Service.
 */
export async function hasOpenDispute(orderId: string, db?: Database): Promise<boolean> {
  const [fila] = await conn(db)
    .select({ cantidad: count() })
    .from(schema.disputes)
    .where(and(eq(schema.disputes.orderId, orderId), ne(schema.disputes.status, 'RESOLVED')));

  return Number(fila?.cantidad ?? 0) > 0;
}

/** Reclamos del comprador, del mas nuevo al mas viejo. */
export async function findByBuyerId(buyerId: string, db?: Database): Promise<DisputeWithOrder[]> {
  return conn(db)
    .select(CON_ORDEN)
    .from(schema.disputes)
    .innerJoin(schema.orders, eq(schema.orders.id, schema.disputes.orderId))
    .where(eq(schema.disputes.buyerId, buyerId))
    .orderBy(desc(schema.disputes.createdAt));
}

/** Reclamos contra el vendedor, del mas nuevo al mas viejo. */
export async function findBySellerId(sellerId: string, db?: Database): Promise<DisputeWithOrder[]> {
  return conn(db)
    .select(CON_ORDEN)
    .from(schema.disputes)
    .innerJoin(schema.orders, eq(schema.orders.id, schema.disputes.orderId))
    .where(eq(schema.disputes.sellerId, sellerId))
    .orderBy(desc(schema.disputes.createdAt));
}

/** Reclamos NO resueltos contra el vendedor. Para el aviso del panel. */
export async function countOpenBySellerId(sellerId: string, db?: Database): Promise<number> {
  const [fila] = await conn(db)
    .select({ cantidad: count() })
    .from(schema.disputes)
    .where(and(eq(schema.disputes.sellerId, sellerId), ne(schema.disputes.status, 'RESOLVED')));

  return Number(fila?.cantidad ?? 0);
}

/**
 * La disputa de una orden, con los datos de la orden.
 *
 * `findByOrderId` devuelve la fila pelada; esta version sirve a las pantallas,
 * que muestran el numero de orden al lado del estado del reclamo.
 */
export async function findByOrderIdWithOrder(
  orderId: string,
  db?: Database,
): Promise<DisputeWithOrder | undefined> {
  const [row] = await conn(db)
    .select(CON_ORDEN)
    .from(schema.disputes)
    .innerJoin(schema.orders, eq(schema.orders.id, schema.disputes.orderId))
    .where(eq(schema.disputes.orderId, orderId))
    .limit(1);

  return row;
}

/** Lo que hace falta de la orden para decidir si se puede reclamar (BR-032/DEC-034). */
export interface OrderForClaim {
  id: string;
  orderNumber: string;
  buyerId: string;
  sellerId: string;
  currency: string;
  totalAmount: bigint;
  status: (typeof schema.orders.status.enumValues)[number];
  paidAt: Date | null;
  shippedAt: Date | null;
  deliveredAt: Date | null;
}

export async function findOrderForClaim(
  orderId: string,
  db?: Database,
): Promise<OrderForClaim | undefined> {
  const [row] = await conn(db)
    .select({
      id: schema.orders.id,
      orderNumber: schema.orders.orderNumber,
      buyerId: schema.orders.buyerId,
      sellerId: schema.orders.sellerId,
      currency: schema.orders.currency,
      totalAmount: schema.orders.totalAmount,
      status: schema.orders.status,
      paidAt: schema.orders.paidAt,
      shippedAt: schema.orders.shippedAt,
      deliveredAt: schema.orders.deliveredAt,
    })
    .from(schema.orders)
    .where(eq(schema.orders.id, orderId))
    .limit(1);

  return row;
}

export interface AdminDisputeFilters {
  /** Uno o varios estados. Sin filtro = todas. */
  statuses?: readonly DisputeStatus[] | undefined;
  sellerId?: string | undefined;
  limit: number;
  offset: number;
}

/**
 * Lista del back-office. Las mas VIEJAS primero: un reclamo que espera hace
 * una semana importa mas que el que acaba de abrirse.
 */
export async function findForAdmin(
  filters: AdminDisputeFilters,
  db?: Database,
): Promise<DisputeWithOrder[]> {
  const condiciones = [];
  if (filters.statuses !== undefined && filters.statuses.length > 0) {
    condiciones.push(inArray(schema.disputes.status, [...filters.statuses]));
  }
  if (filters.sellerId !== undefined) {
    condiciones.push(eq(schema.disputes.sellerId, filters.sellerId));
  }

  return conn(db)
    .select(CON_ORDEN)
    .from(schema.disputes)
    .innerJoin(schema.orders, eq(schema.orders.id, schema.disputes.orderId))
    .where(condiciones.length > 0 ? and(...condiciones) : undefined)
    .orderBy(asc(schema.disputes.createdAt))
    .limit(filters.limit)
    .offset(filters.offset);
}

export interface InsertDisputeValues {
  orderId: string;
  buyerId: string;
  sellerId: string;
  reason: DisputeReason;
  currency: string;
  openedAt: Date;
}

/** Nace en `OPEN` (default del ERD). El Service la pasa a `WAITING_SELLER`. */
export async function insertOpen(values: InsertDisputeValues, db?: Database): Promise<DisputeRow> {
  const [row] = await conn(db)
    .insert(schema.disputes)
    .values({
      orderId: values.orderId,
      buyerId: values.buyerId,
      sellerId: values.sellerId,
      reason: values.reason,
      currency: values.currency,
      openedAt: values.openedAt,
      status: 'OPEN',
    })
    .returning();

  return row!;
}

export interface TransitionValues {
  sellerResponseDueAt?: Date;
  sellerRespondedAt?: Date;
  resolvedAt?: Date;
  resolution?: DisputeResolution;
}

/**
 * Cambia el estado SOLO si la disputa esta en `from`.
 *
 * ⚠️ LA CONDICION VA EN EL WHERE, igual que en `orders` y `trust`: dos
 * administradores resolviendo a la vez, o el barrido de escalada corriendo
 * mientras el vendedor responde, no pueden pisarse. El segundo recibe
 * `undefined` y el Service decide que decirle.
 */
export async function transitionStatus(
  id: string,
  from: DisputeStatus,
  to: DisputeStatus,
  values: TransitionValues = {},
  db?: Database,
): Promise<DisputeRow | undefined> {
  const [row] = await conn(db)
    .update(schema.disputes)
    .set({ status: to, ...values })
    .where(and(eq(schema.disputes.id, id), eq(schema.disputes.status, from)))
    .returning();

  return row;
}

/** Importe efectivamente devuelto. Se escribe cuando se conoce el resultado en MP. */
export async function updateRefundedAmount(
  id: string,
  refundedAmount: bigint,
  db?: Database,
): Promise<void> {
  await conn(db).update(schema.disputes).set({ refundedAmount }).where(eq(schema.disputes.id, id));
}

/** `WAITING_SELLER` con el plazo del vendedor ya vencido. Para el barrido. */
export async function findExpiredWaitingSeller(
  now: Date,
  limit: number,
  db?: Database,
): Promise<DisputeRow[]> {
  return conn(db)
    .select()
    .from(schema.disputes)
    .where(
      and(
        eq(schema.disputes.status, 'WAITING_SELLER'),
        lt(schema.disputes.sellerResponseDueAt, now),
      ),
    )
    .orderBy(asc(schema.disputes.sellerResponseDueAt))
    .limit(limit);
}

/* -------------------------------------------------------------------------- */
/* Evidencias (INMUTABLES, TS-061: solo insert y lectura)                      */
/* -------------------------------------------------------------------------- */

export interface InsertEvidenceValues {
  disputeId: string;
  uploadedBy: EvidenceUploader;
  uploaderId: string | null;
  /** 'description' / 'response' / 'text' / 'url'. Es `text` en el ERD. */
  type: string;
  url: string | null;
  note: string | null;
}

/**
 * ⚠️ `storage_key` SIEMPRE null: las evidencias son texto o URL. Nunca van al
 * bucket publico de fotos (contexto comun de la ola). No hay funcion que lo
 * escriba a proposito.
 */
export async function insertEvidences(
  values: InsertEvidenceValues[],
  db?: Database,
): Promise<DisputeEvidenceRow[]> {
  if (values.length === 0) return [];

  return conn(db)
    .insert(schema.disputeEvidences)
    .values(
      values.map((v) => ({
        disputeId: v.disputeId,
        uploadedBy: v.uploadedBy,
        uploaderId: v.uploaderId,
        type: v.type,
        storageKey: null,
        url: v.url,
        note: v.note,
      })),
    )
    .returning();
}

export async function findEvidences(
  disputeId: string,
  db?: Database,
): Promise<DisputeEvidenceRow[]> {
  return conn(db)
    .select()
    .from(schema.disputeEvidences)
    .where(eq(schema.disputeEvidences.disputeId, disputeId))
    .orderBy(asc(schema.disputeEvidences.createdAt), asc(schema.disputeEvidences.id));
}

/* -------------------------------------------------------------------------- */
/* Acciones de la resolucion (ERD §14.3)                                       */
/* -------------------------------------------------------------------------- */

export interface InsertActionValues {
  disputeId: string;
  action: DisputeResolution;
  amount: bigint | null;
  currency: string;
  decidedBy: string;
  note: string | null;
}

export async function insertActions(
  values: InsertActionValues[],
  db?: Database,
): Promise<DisputeActionRow[]> {
  if (values.length === 0) return [];

  return conn(db).insert(schema.disputeActions).values(values).returning();
}

export async function findActions(disputeId: string, db?: Database): Promise<DisputeActionRow[]> {
  return conn(db)
    .select()
    .from(schema.disputeActions)
    .where(eq(schema.disputeActions.disputeId, disputeId))
    .orderBy(asc(schema.disputeActions.createdAt), asc(schema.disputeActions.id));
}

/* -------------------------------------------------------------------------- */
/* Lecturas de otras tablas (ver el comentario de cabecera)                    */
/* -------------------------------------------------------------------------- */

/** Usuario detras de un perfil de vendedor. Para autorizar y para el historial. */
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

export interface PartyContact {
  userId: string;
  email: string;
  displayName: string | null;
}

/** Email y nombre de comprador y vendedor, para los avisos. */
export async function findPartiesContact(
  dispute: Pick<DisputeRow, 'buyerId' | 'sellerId'>,
  db?: Database,
): Promise<{ buyer: PartyContact | undefined; seller: PartyContact | undefined }> {
  const database = conn(db);

  const [buyer] = await database
    .select({
      userId: schema.users.id,
      email: schema.users.email,
      displayName: schema.users.displayName,
    })
    .from(schema.users)
    .where(eq(schema.users.id, dispute.buyerId))
    .limit(1);

  const [seller] = await database
    .select({
      userId: schema.users.id,
      email: schema.users.email,
      // El nombre de la tienda, no el de la persona: es como el vendedor se
      // presenta en el marketplace.
      displayName: schema.sellerProfiles.displayName,
    })
    .from(schema.sellerProfiles)
    .innerJoin(schema.users, eq(schema.users.id, schema.sellerProfiles.userId))
    .where(eq(schema.sellerProfiles.id, dispute.sellerId))
    .limit(1);

  return { buyer, seller };
}
