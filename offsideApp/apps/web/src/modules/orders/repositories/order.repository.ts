import { getDatabase, schema, type Database } from '@offside/database';
import { and, asc, count, desc, eq, exists, inArray, lte, notExists, sql } from 'drizzle-orm';

/**
 * Acceso a `orders` y `order_items` (ERD §11). Sin reglas de negocio.
 *
 * ⚠️ ALCANCE MINIMO. El modulo `orders` completo —creacion, carrito, calculo
 * del snapshot, ciclo logistico— NO esta implementado. Aca vive solo lo que
 * `payments` necesita para cobrar una orden que ya existe, porque un modulo no
 * puede importar el repository de otro (`modules/README.md`).
 */

export type OrderRow = typeof schema.orders.$inferSelect;
export type OrderItemRow = typeof schema.orderItems.$inferSelect;
export type OrderStatusHistoryRow = typeof schema.orderStatusHistory.$inferSelect;
export type OrderStatus = OrderRow['status'];

const conn = (db?: Database): Database => db ?? getDatabase();

export async function findById(id: string, db?: Database): Promise<OrderRow | undefined> {
  const [row] = await conn(db)
    .select()
    .from(schema.orders)
    .where(eq(schema.orders.id, id))
    .limit(1);

  return row;
}

/** Usuario dueño de un perfil de vendedor. Para impedir comprarse a si mismo. */
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

/**
 * ⚠️ EL `ORDER BY` NO ES COSMETICO. Sin `ORDER BY`, PostgreSQL puede devolver
 * las filas en cualquier orden, y en la practica las reordena al hacer un
 * UPDATE: cobrar una orden movia la lista de compras de lugar y la persona veia
 * su historial barajarse solo. Mas nueva primero, que es el orden en que se
 * mira un historial.
 */
export async function findByBuyerId(
  buyerId: string,
  db?: Database,
  filtro: { status?: OrderStatus | undefined } = {},
): Promise<OrderRow[]> {
  return conn(db)
    .select()
    .from(schema.orders)
    .where(
      and(
        eq(schema.orders.buyerId, buyerId),
        filtro.status === undefined ? undefined : eq(schema.orders.status, filtro.status),
      ),
    )
    .orderBy(desc(schema.orders.createdAt));
}

/** Orden por su numero visible (`OFF-XXXXXXXXXX`). Para el back-office. */
export async function findByOrderNumber(
  orderNumber: string,
  db?: Database,
): Promise<OrderRow | undefined> {
  const [row] = await conn(db)
    .select()
    .from(schema.orders)
    .where(eq(schema.orders.orderNumber, orderNumber))
    .limit(1);

  return row;
}

/**
 * Cuantas ordenes recibio un vendedor, por estado.
 *
 * ⚠️ `COUNT` Y NO CONTAR FILAS EN MEMORIA: el panel muestra un numero y no
 * necesita las ordenes. Traerlas todas para hacer `.length` crece con el
 * historial del vendedor y se paga en cada visita.
 */
export async function countBySellerId(
  sellerId: string,
  db?: Database,
): Promise<{ status: OrderRow['status']; cantidad: number }[]> {
  const filas = await conn(db)
    .select({ status: schema.orders.status, cantidad: count() })
    .from(schema.orders)
    .where(eq(schema.orders.sellerId, sellerId))
    .groupBy(schema.orders.status);

  return filas.map((fila) => ({ status: fila.status, cantidad: Number(fila.cantidad) }));
}

/** Ordenes recibidas por un vendedor (SS-070). Mismo criterio de orden. */
export async function findBySellerId(
  sellerId: string,
  db?: Database,
  filtro: { status?: OrderStatus | undefined } = {},
): Promise<OrderRow[]> {
  return conn(db)
    .select()
    .from(schema.orders)
    .where(
      and(
        eq(schema.orders.sellerId, sellerId),
        filtro.status === undefined ? undefined : eq(schema.orders.status, filtro.status),
      ),
    )
    .orderBy(desc(schema.orders.createdAt));
}

export async function findItems(orderId: string, db?: Database): Promise<OrderItemRow[]> {
  return conn(db).select().from(schema.orderItems).where(eq(schema.orderItems.orderId, orderId));
}

/**
 * Items de VARIAS ordenes en una sola consulta.
 *
 * ⚠️ EXISTE PARA NO HACER N+1. "Mis compras" necesita decir QUE se compro en
 * cada orden, y pedir los items de a una seria una consulta por fila de la
 * lista. Es el mismo criterio que ya usa la vitrina para las portadas.
 */
export async function findItemsByOrderIds(
  orderIds: string[],
  db?: Database,
): Promise<OrderItemRow[]> {
  if (orderIds.length === 0) return [];

  return conn(db)
    .select()
    .from(schema.orderItems)
    .where(inArray(schema.orderItems.orderId, orderIds));
}

/**
 * Marca la orden como pagada.
 *
 * ⚠️ CONDICIONAL: solo transiciona desde `PENDING_PAYMENT`. Si la orden ya esta
 * `PAID` devuelve `undefined` y quien llama lo trata como no-op. Eso es lo que
 * hace idempotente al webhook duplicado sin necesidad de un lock.
 */
export async function markAsPaid(
  orderId: string,
  paidAt: Date,
  db?: Database,
): Promise<OrderRow | undefined> {
  const [row] = await conn(db)
    .update(schema.orders)
    .set({ status: 'PAID', paidAt })
    .where(and(eq(schema.orders.id, orderId), eq(schema.orders.status, 'PENDING_PAYMENT')))
    .returning();

  return row;
}

/** Registra la transicion en `order_status_history` (ERD §11.3). */
export async function appendStatusHistory(
  values: {
    orderId: string;
    fromStatus: OrderRow['status'];
    toStatus: OrderRow['status'];
    actorType: 'user' | 'seller' | 'admin' | 'system';
    actorId?: string | undefined;
    note?: string | undefined;
  },
  db?: Database,
): Promise<void> {
  await conn(db)
    .insert(schema.orderStatusHistory)
    .values({
      orderId: values.orderId,
      fromStatus: values.fromStatus,
      toStatus: values.toStatus,
      actorType: values.actorType,
      actorId: values.actorId ?? null,
      note: values.note ?? null,
    });
}

export interface InsertOrderValues {
  orderNumber: string;
  buyerId: string;
  sellerId: string;
  currency: string;
  productAmount: bigint;
  /** Costo de envio congelado en la orden (SH-011). 0 si no se cotizo. */
  shippingAmount?: bigint | undefined;
  totalAmount: bigint;
  commissionRateAtTransaction: string;
  commissionAmount: bigint;
  sellerAmount: bigint;
  shippingAddress: unknown;
  /** Vencimiento de la ventana de pago (DEC-033), ya calculado por el Service. */
  paymentDeadline?: Date | null | undefined;
  // --- Snapshot de POR QUE la comision fue la que fue (DEC-030) ---
  sellerTierCodeAtTransaction?: string | null | undefined;
  /** Como string `numeric(6,3)`: `'3.000'`. Null = sin promocion. */
  promotionMultiplierAtTransaction?: string | null | undefined;
  commissionSource?: 'default' | 'seller_tier' | 'promoted' | undefined;
  listingPromotionId?: string | null | undefined;
}

export interface InsertOrderItemValues {
  listingId: string;
  titleSnapshot: string;
  unitPriceAmount: bigint;
  currency: string;
  quantity: number;
}

/**
 * Crea la orden con sus items en UNA transaccion.
 *
 * `payment_deadline` lo calcula el Service a partir de
 * `app_settings.payment_window_minutes` (DEC-033). Si llega `null` —no
 * deberia—, el checkout no aplica vencimiento y la preferencia se crea sin
 * `expires`, que era el comportamiento previo.
 */
export async function insertOrder(
  order: InsertOrderValues,
  items: InsertOrderItemValues[],
  db?: Database,
): Promise<{ order: OrderRow; items: OrderItemRow[] }> {
  const ejecutar = async (tx: Database) => {
    const [creada] = await tx
      .insert(schema.orders)
      .values({
        orderNumber: order.orderNumber,
        buyerId: order.buyerId,
        sellerId: order.sellerId,
        status: 'PENDING_PAYMENT',
        currency: order.currency,
        productAmount: order.productAmount,
        shippingAmount: order.shippingAmount ?? 0n,
        totalAmount: order.totalAmount,
        commissionRateAtTransaction: order.commissionRateAtTransaction,
        commissionAmount: order.commissionAmount,
        sellerAmount: order.sellerAmount,
        sellerTierCodeAtTransaction: order.sellerTierCodeAtTransaction ?? null,
        promotionMultiplierAtTransaction: order.promotionMultiplierAtTransaction ?? null,
        commissionSource: order.commissionSource ?? 'default',
        listingPromotionId: order.listingPromotionId ?? null,
        shippingAddress: order.shippingAddress,
        paymentDeadline: order.paymentDeadline ?? null,
      })
      .returning();

    const insertados = await tx
      .insert(schema.orderItems)
      .values(
        items.map((item) => ({
          orderId: creada!.id,
          listingId: item.listingId,
          titleSnapshot: item.titleSnapshot,
          unitPriceAmount: item.unitPriceAmount,
          currency: item.currency,
          quantity: item.quantity,
        })),
      )
      .returning();

    await tx.insert(schema.orderStatusHistory).values({
      orderId: creada!.id,
      fromStatus: null,
      toStatus: 'PENDING_PAYMENT',
      actorType: 'user',
      actorId: order.buyerId,
      note: 'Orden creada',
    });

    return { order: creada!, items: insertados };
  };

  return db === undefined ? getDatabase().transaction(ejecutar) : ejecutar(db);
}

/* -------------------------------------------------------------------------- */
/* Ciclo de vida (DEC-029)                                                     */
/* -------------------------------------------------------------------------- */

/** Columnas de fecha que una transicion puede sellar. */
export interface TransitionTimestamps {
  paidAt?: Date | undefined;
  shippedAt?: Date | undefined;
  deliveredAt?: Date | undefined;
  completedAt?: Date | undefined;
  cancelledAt?: Date | undefined;
}

/**
 * Transiciona la orden de `from` a `to`, CONDICIONADO al estado de origen.
 *
 * ⚠️ ES LA UNICA ESCRITURA DE `orders.status` fuera de `insertOrder`, y el
 * `WHERE status = from` es lo que la vuelve segura ante carreras: si dos
 * procesos intentan mover la misma orden, el segundo ve `undefined` y no
 * pisa nada. `markAsPaid` ya usaba este truco para el webhook duplicado; se
 * generaliza en vez de repetirlo por transicion.
 *
 * NO valida que la transicion tenga sentido: eso lo decide la maquina de
 * estados del Service (`order-transitions.ts`). Aca solo se escribe.
 */
export async function transitionStatus(
  orderId: string,
  from: OrderStatus,
  to: OrderStatus,
  timestamps: TransitionTimestamps = {},
  db?: Database,
): Promise<OrderRow | undefined> {
  const [row] = await conn(db)
    .update(schema.orders)
    .set({ status: to, ...sinUndefined(timestamps) })
    .where(and(eq(schema.orders.id, orderId), eq(schema.orders.status, from)))
    .returning();

  return row;
}

/** Drizzle interpreta `undefined` como "no tocar", pero se filtra igual por claridad. */
function sinUndefined(valores: TransitionTimestamps): Record<string, Date> {
  return Object.fromEntries(
    Object.entries(valores).filter(
      (entrada): entrada is [string, Date] => entrada[1] !== undefined,
    ),
  );
}

/** Una entrada del historial con quien la hizo. */
export interface StatusHistoryEntry extends OrderStatusHistoryRow {
  /** Nombre visible del actor humano; null para el sistema o si no lo cargo. */
  actorDisplayName: string | null;
}

/**
 * Historial de estados de una orden, del mas viejo al mas nuevo.
 *
 * Es una linea de tiempo: se lee en el orden en que paso. El `ORDER BY` lleva
 * el `id` de desempate porque dos transiciones de la misma transaccion (PAID y
 * PROCESSING) comparten `created_at` al milisegundo.
 */
export async function findStatusHistory(
  orderId: string,
  db?: Database,
): Promise<StatusHistoryEntry[]> {
  const filas = await conn(db)
    .select({
      historia: schema.orderStatusHistory,
      actorDisplayName: schema.users.displayName,
    })
    .from(schema.orderStatusHistory)
    .leftJoin(schema.users, eq(schema.users.id, schema.orderStatusHistory.actorId))
    .where(eq(schema.orderStatusHistory.orderId, orderId))
    .orderBy(asc(schema.orderStatusHistory.createdAt), asc(schema.orderStatusHistory.id));

  return filas.map((fila) => ({ ...fila.historia, actorDisplayName: fila.actorDisplayName }));
}

/**
 * Predicado: la orden tiene un pago EN CURSO que Mercado Pago ya conoce.
 *
 * ⚠️ `mp_payment_id IS NOT NULL` ES LA MITAD QUE IMPORTA. `payments` inserta
 * una fila `PENDING` al INICIAR el checkout, antes de que la persona vea la
 * pantalla de Mercado Pago: si bastara con `status = 'PENDING'`, toda orden
 * cuyo comprador abrio el checkout y lo cerro quedaria sin vencer nunca. Con
 * `mp_payment_id` cargado, en cambio, MP registro un pago y lo informo por
 * webhook —el caso del ticket de Rapipago que se acredita al dia siguiente—
 * y ahi si hay que esperar.
 */
function pagoEnCursoEnMercadoPago(database: Database) {
  return database
    .select({ uno: sql`1` })
    .from(schema.payments)
    .where(
      and(
        eq(schema.payments.orderId, schema.orders.id),
        inArray(schema.payments.status, ['PENDING', 'IN_PROCESS']),
        sql`${schema.payments.mpPaymentId} IS NOT NULL`,
      ),
    );
}

/**
 * Ordenes en `PENDING_PAYMENT` cuya ventana de pago vencio (DEC-033).
 *
 * ⚠️ EXCLUYE LAS QUE TIENEN UN PAGO EN CURSO en Mercado Pago (`PENDING` /
 * `IN_PROCESS` con `mp_payment_id`): quien pago en efectivo por Rapipago tiene
 * el ticket en la mano y el dinero llega despues. Cancelar esa orden y recibir
 * el webhook aprobado un minuto mas tarde dejaria plata cobrada sobre una
 * orden cancelada. Se lee `payments` por SQL, no por su repository, porque es
 * un predicado del barrido y no logica de pagos. ASUMIDO: la doc no contempla
 * el caso. Las excluidas las devuelve `findExpiredPendingWithPaymentInProgress`
 * para que el barrido las audite.
 *
 * Acotado por `limit`: el barrido corre seguido y procesa de a tandas.
 */
export async function findExpiredPendingPayment(
  now: Date,
  limit: number,
  db?: Database,
): Promise<OrderRow[]> {
  const database = conn(db);

  return database
    .select()
    .from(schema.orders)
    .where(
      and(
        eq(schema.orders.status, 'PENDING_PAYMENT'),
        lte(schema.orders.paymentDeadline, now),
        notExists(pagoEnCursoEnMercadoPago(database)),
      ),
    )
    .orderBy(asc(schema.orders.paymentDeadline))
    .limit(limit);
}

/** La contracara: vencidas pero con un pago en curso en Mercado Pago. Se auditan, no se cancelan. */
export async function findExpiredPendingWithPaymentInProgress(
  now: Date,
  limit: number,
  db?: Database,
): Promise<OrderRow[]> {
  const database = conn(db);

  return database
    .select()
    .from(schema.orders)
    .where(
      and(
        eq(schema.orders.status, 'PENDING_PAYMENT'),
        lte(schema.orders.paymentDeadline, now),
        exists(pagoEnCursoEnMercadoPago(database)),
      ),
    )
    .orderBy(asc(schema.orders.paymentDeadline))
    .limit(limit);
}

/**
 * Hay una disputa abierta (no `RESOLVED`) sobre la orden.
 *
 * `disputes` es de un modulo que no existe todavia; se lee por SQL porque
 * BR-033 hace depender el cierre de la orden de que NO haya reclamo, y eso
 * es un predicado de `orders`. Cuando exista `modules/disputes`, esto pasa a
 * ser una llamada a su Service.
 */
export async function hasOpenDispute(orderId: string, db?: Database): Promise<boolean> {
  const [fila] = await conn(db)
    .select({ cantidad: count() })
    .from(schema.disputes)
    .where(and(eq(schema.disputes.orderId, orderId), sql`${schema.disputes.status} <> 'RESOLVED'`));

  return Number(fila?.cantidad ?? 0) > 0;
}

/**
 * Ordenes `DELIVERED` entregadas antes de `cutoff` y sin disputa abierta:
 * las que la ventana de proteccion ya dejo cerrar (BR-033 / MF-040).
 */
export async function findDeliveredReadyToComplete(
  cutoff: Date,
  limit: number,
  db?: Database,
): Promise<OrderRow[]> {
  const database = conn(db);

  return database
    .select()
    .from(schema.orders)
    .where(
      and(
        eq(schema.orders.status, 'DELIVERED'),
        lte(schema.orders.deliveredAt, cutoff),
        notExists(
          database
            .select({ uno: sql`1` })
            .from(schema.disputes)
            .where(
              and(
                eq(schema.disputes.orderId, schema.orders.id),
                sql`${schema.disputes.status} <> 'RESOLVED'`,
              ),
            ),
        ),
      ),
    )
    .orderBy(asc(schema.orders.deliveredAt))
    .limit(limit);
}

/** Nombre visible del comprador, para la ficha de venta (SS-071). */
export async function findBuyerDisplayName(
  buyerId: string,
  db?: Database,
): Promise<string | null | undefined> {
  const [row] = await conn(db)
    .select({ displayName: schema.users.displayName })
    .from(schema.users)
    .where(eq(schema.users.id, buyerId))
    .limit(1);

  return row === undefined ? undefined : row.displayName;
}

/**
 * Nombre de tienda del vendedor de una orden.
 *
 * ⚠️ SALE DE `seller_profiles`, NO DE `users`: es como el vendedor se presenta
 * en el marketplace, y es lo que el comprador reconoce. El nombre de la
 * persona detras del perfil no es asunto de quien compro.
 */
export async function findSellerDisplayName(
  sellerId: string,
  db?: Database,
): Promise<string | undefined> {
  const [row] = await conn(db)
    .select({ displayName: schema.sellerProfiles.displayName })
    .from(schema.sellerProfiles)
    .where(eq(schema.sellerProfiles.id, sellerId))
    .limit(1);

  return row?.displayName;
}

/**
 * Valor NUMERICO vigente de una clave global de `app_settings`.
 *
 * ⚠️ DUPLICA LA LECTURA DEL CONFIG STORE, y es a proposito y temporal: el
 * Service de `config` solo expone la comision, y un modulo no importa el
 * repository de otro. Cuando `config` exponga `getNumberSetting(key)`, esto
 * se borra y se llama a eso. Devuelve `undefined` si la clave no esta
 * cargada; validar el tipo es del Service.
 */
export async function findGlobalSettingValue(key: string, db?: Database): Promise<unknown> {
  const [row] = await conn(db)
    .select({ value: schema.appSettings.value })
    .from(schema.appSettings)
    .where(
      and(
        eq(schema.appSettings.scope, 'global'),
        sql`${schema.appSettings.scopeId} IS NULL`,
        eq(schema.appSettings.key, key),
      ),
    )
    .orderBy(desc(schema.appSettings.version))
    .limit(1);

  return row?.value;
}

export interface AppendHistoryEventValues {
  userId: string;
  eventType: 'PURCHASE_COMPLETED' | 'SALE_COMPLETED' | 'ORDER_CANCELLED';
  role: 'buyer' | 'seller';
  orderId: string;
  data: Record<string, unknown>;
}

/**
 * Emite un HECHO en `user_history_events` (ERD §6.3, DEC-036).
 *
 * ⚠️ APPEND-ONLY, y el evento lleva la orden como referencia
 * (`ref_entity_type = 'order'`) para que la proyeccion de reputacion pueda
 * volver al origen. Escribe la tabla de `users` desde aca porque su Service
 * solo sabe registrar altas; cuando exponga `recordOrderFact()`, se migra.
 */
export async function appendUserHistoryEvent(
  values: AppendHistoryEventValues,
  db?: Database,
): Promise<void> {
  await conn(db).insert(schema.userHistoryEvents).values({
    userId: values.userId,
    eventType: values.eventType,
    role: values.role,
    refEntityType: 'order',
    refEntityId: values.orderId,
    data: values.data,
  });
}

/**
 * Ordenes que se quedaron en `PAID`: pagadas y sin stock para cumplir
 * (`aplicarAprobacion` en `payments` deja constancia con
 * `ORDER_PAID_WITHOUT_STOCK`). Desde la fecha de pago mas vieja, que es la
 * que mas urge resolver. Para el back-office.
 */
export async function findStuckInPaid(limit: number, db?: Database): Promise<OrderRow[]> {
  return conn(db)
    .select()
    .from(schema.orders)
    .where(eq(schema.orders.status, 'PAID'))
    .orderBy(asc(schema.orders.paidAt), asc(schema.orders.id))
    .limit(limit);
}

export interface RestoredStock {
  listingId: string;
  quantity: number;
  /** Stock resultante. */
  stock: number;
  /** La publicacion estaba `sold_out` y volvio a `active`. */
  reactivated: boolean;
}

/**
 * Repone el stock que `decrementStockForOrder` descontó (cancelacion antes de
 * despachar). Atomico por publicacion: un UPDATE con suma en SQL, no un
 * read-modify-write.
 *
 * ⚠️ ESCRIBE `listings` DESDE `orders`, y es una duplicacion CONSCIENTE del
 * mismo tipo que `hasOpenDispute` (disputes) y `findGlobalSettingValue`
 * (config): un modulo no importa el repository de otro, y `listings` todavia
 * no expone `restoreStock()` ni `reactivateIfSoldOut()` en su Service. Cuando
 * los exponga, esto se borra y `cancelBySeller` los llama (NECESITA-DE-OTROS).
 *
 * `sold_out → active` SOLO desde `sold_out`: es el unico estado que SS-051
 * pone automaticamente. Una publicacion `paused` la pauso una persona y no la
 * pisa una cancelacion; una `deleted` es terminal.
 */
export async function restoreStockForOrder(
  orderId: string,
  db?: Database,
): Promise<RestoredStock[]> {
  const items = await findItems(orderId, db);
  const repuestos: RestoredStock[] = [];

  for (const item of items) {
    const [fila] = await conn(db)
      .update(schema.listings)
      .set({ stock: sql`${schema.listings.stock} + ${item.quantity}`, updatedAt: new Date() })
      .where(eq(schema.listings.id, item.listingId))
      .returning({ stock: schema.listings.stock, status: schema.listings.status });

    if (fila === undefined) continue;

    let reactivated = false;
    if (fila.status === 'sold_out' && fila.stock > 0) {
      const reactivadas = await conn(db)
        .update(schema.listings)
        .set({ status: 'active', updatedAt: new Date() })
        .where(and(eq(schema.listings.id, item.listingId), eq(schema.listings.status, 'sold_out')))
        .returning({ id: schema.listings.id });
      reactivated = reactivadas.length === 1;
    }

    repuestos.push({
      listingId: item.listingId,
      quantity: item.quantity,
      stock: fila.stock,
      reactivated,
    });
  }

  return repuestos;
}

/**
 * Ids y estados de los pagos de la orden. Para dejar en la auditoria de una
 * cancelacion QUE pago hay que reembolsar; el refund lo ejecuta `payments`.
 * Lectura por SQL de una tabla ajena, mismo criterio que `pagoEnCursoEnMercadoPago`.
 */
export async function findPaymentRefs(
  orderId: string,
  db?: Database,
): Promise<{ id: string; status: string; mpPaymentId: string | null }[]> {
  return conn(db)
    .select({
      id: schema.payments.id,
      status: schema.payments.status,
      mpPaymentId: schema.payments.mpPaymentId,
    })
    .from(schema.payments)
    .where(eq(schema.payments.orderId, orderId))
    .orderBy(asc(schema.payments.createdAt));
}
