import { getDatabase, schema, type Database } from '@offside/database';
import { and, eq } from 'drizzle-orm';

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

export async function findByBuyerId(buyerId: string, db?: Database): Promise<OrderRow[]> {
  return conn(db).select().from(schema.orders).where(eq(schema.orders.buyerId, buyerId));
}

/** Ordenes recibidas por un vendedor (SS-070). */
export async function findBySellerId(sellerId: string, db?: Database): Promise<OrderRow[]> {
  return conn(db).select().from(schema.orders).where(eq(schema.orders.sellerId, sellerId));
}

export async function findItems(orderId: string, db?: Database): Promise<OrderItemRow[]> {
  return conn(db).select().from(schema.orderItems).where(eq(schema.orderItems.orderId, orderId));
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
  totalAmount: bigint;
  commissionRateAtTransaction: string;
  commissionAmount: bigint;
  sellerAmount: bigint;
  shippingAddress: unknown;
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
 * ⚠️ `payment_deadline` queda NULL: el PLAZO de la ventana de pago es ⚙️
 * configurable y su valor sigue 🟡 sin decidir (DEC-033). Escribir un numero
 * aca seria inventar la decision. Con NULL, el checkout no aplica vencimiento y
 * la preferencia se crea sin `expires`.
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
        totalAmount: order.totalAmount,
        commissionRateAtTransaction: order.commissionRateAtTransaction,
        commissionAmount: order.commissionAmount,
        sellerAmount: order.sellerAmount,
        shippingAddress: order.shippingAddress,
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
