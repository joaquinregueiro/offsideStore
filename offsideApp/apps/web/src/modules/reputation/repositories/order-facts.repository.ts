import { getDatabase, schema, type Database } from '@offside/database';
import { and, desc, eq } from 'drizzle-orm';

/**
 * Lectura de la orden y de su historial de estados, para EMITIR hechos de
 * reputacion (`user_history_events`, ERD §6.3). Sin reglas de negocio.
 *
 * ⚠️ POR QUE ESTE MODULO LEE `orders`: los hooks `onOrderCompleted` y
 * `onOrderCancelled` reciben SOLO el id de la orden —asi la firma no depende
 * de la forma interna de `orders`— y un modulo no puede importar el
 * Repository de otro (`modules/README.md`). Es lectura pura: `orders` sigue
 * siendo el unico que escribe su tabla. Mismo criterio que
 * `reputation.repository.ts` con `disputes`, `refunds` y `shipments`.
 */

export type OrderStatus = (typeof schema.orderStatus.enumValues)[number];

const conn = (db?: Database): Database => db ?? getDatabase();

export interface OrderFactContext {
  orderId: string;
  orderNumber: string;
  status: OrderStatus;
  buyerId: string;
  sellerId: string;
  /** `users.id` del vendedor: el historial esta indexado por usuario. */
  sellerUserId: string;
  totalAmount: bigint;
  currency: string;
  completedAt: Date | null;
  cancelledAt: Date | null;
}

export async function findOrderFactContext(
  orderId: string,
  db?: Database,
): Promise<OrderFactContext | undefined> {
  const [row] = await conn(db)
    .select({
      orderId: schema.orders.id,
      orderNumber: schema.orders.orderNumber,
      status: schema.orders.status,
      buyerId: schema.orders.buyerId,
      sellerId: schema.orders.sellerId,
      sellerUserId: schema.sellerProfiles.userId,
      totalAmount: schema.orders.totalAmount,
      currency: schema.orders.currency,
      completedAt: schema.orders.completedAt,
      cancelledAt: schema.orders.cancelledAt,
    })
    .from(schema.orders)
    .innerJoin(schema.sellerProfiles, eq(schema.orders.sellerId, schema.sellerProfiles.id))
    .where(eq(schema.orders.id, orderId))
    .limit(1);

  return row;
}

/**
 * Quien cancelo, segun `order_status_history` (ERD §11.3). Los roles son los
 * de la ORDEN (`buyer`/`seller`), no los del sistema: `actor_type = 'user'`
 * en una cancelacion es el comprador.
 */
export type CancellationActor = 'buyer' | 'seller' | 'admin' | 'system';

const ACTOR_DE_HISTORIAL: Record<(typeof schema.actorType.enumValues)[number], CancellationActor> =
  {
    user: 'buyer',
    seller: 'seller',
    admin: 'admin',
    system: 'system',
  };

/**
 * Actor de la ULTIMA transicion a `CANCELLED`, o `undefined` si la orden no
 * tiene esa fila (una cancelacion escrita sin pasar por el Service de orders).
 */
export async function findCancellationActor(
  orderId: string,
  db?: Database,
): Promise<CancellationActor | undefined> {
  const [row] = await conn(db)
    .select({ actorType: schema.orderStatusHistory.actorType })
    .from(schema.orderStatusHistory)
    .where(
      and(
        eq(schema.orderStatusHistory.orderId, orderId),
        eq(schema.orderStatusHistory.toStatus, 'CANCELLED'),
      ),
    )
    .orderBy(desc(schema.orderStatusHistory.createdAt), desc(schema.orderStatusHistory.id))
    .limit(1);

  if (row === undefined) return undefined;

  return ACTOR_DE_HISTORIAL[row.actorType];
}
