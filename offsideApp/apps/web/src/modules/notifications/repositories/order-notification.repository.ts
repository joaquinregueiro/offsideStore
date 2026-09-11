import { asc, eq } from 'drizzle-orm';

import { getDatabase, schema, type Database } from '@offside/database';

/**
 * Lecturas que necesita el AVISO de una transicion de orden: quien es cada
 * parte y que compro.
 *
 * ⚠️ VIVE EN `notifications` Y CONSULTA TABLAS DE `orders`, Y ES DELIBERADO.
 * La alternativa —que `orders` exponga un `getOrderForNotification()`— le
 * agregaria a su Service una funcion que solo sirve para mandar mails, y el
 * comentario de `order-events.ts` es explicito en que `orders` no sabe que
 * existen los avisos. Es la misma excepcion acotada que ya se toma
 * `disputes/repositories/dispute.repository.ts`: un repositorio puede LEER una
 * tabla ajena; lo que nunca hace es escribirla.
 */

const conn = (db?: Database): Database => db ?? getDatabase();

export interface OrderParty {
  userId: string;
  email: string;
  /** El nombre visible; `null` si nunca lo cargo. */
  displayName: string | null;
}

export interface OrderNotificationContext {
  orderId: string;
  orderNumber: string;
  totalAmount: bigint;
  /** `null` hasta que la orden congela su snapshot economico. */
  sellerAmount: bigint | null;
  currency: string;
  buyer: OrderParty;
  /** `undefined` si el perfil del vendedor desaparecio (no deberia pasar). */
  seller: OrderParty | undefined;
  items: { titulo: string; cantidad: number }[];
  /**
   * Envio manual cargado por el vendedor, si ya despacho.
   *
   * ⚠️ `provider` ES EL TRANSPORTISTA. El ERD no tiene una columna `carrier`:
   * `shipments.provider` guarda con quien se despacho (hoy siempre carga
   * manual del vendedor, de la lista ⚙️ `shipping_carriers`).
   */
  envio: { transportista: string | null; trackingNumber: string | null } | undefined;
}

export async function findOrderNotificationContext(
  orderId: string,
  db?: Database,
): Promise<OrderNotificationContext | undefined> {
  const database = conn(db);

  const [orden] = await database
    .select({
      orderId: schema.orders.id,
      orderNumber: schema.orders.orderNumber,
      totalAmount: schema.orders.totalAmount,
      sellerAmount: schema.orders.sellerAmount,
      currency: schema.orders.currency,
      buyerId: schema.orders.buyerId,
      sellerId: schema.orders.sellerId,
      buyerEmail: schema.users.email,
      buyerDisplayName: schema.users.displayName,
    })
    .from(schema.orders)
    .innerJoin(schema.users, eq(schema.users.id, schema.orders.buyerId))
    .where(eq(schema.orders.id, orderId))
    .limit(1);

  if (orden === undefined) return undefined;

  const [vendedor] = await database
    .select({
      userId: schema.users.id,
      email: schema.users.email,
      // El nombre de la TIENDA, no el de la persona: es como el vendedor se
      // presenta en el marketplace.
      displayName: schema.sellerProfiles.displayName,
    })
    .from(schema.sellerProfiles)
    .innerJoin(schema.users, eq(schema.users.id, schema.sellerProfiles.userId))
    .where(eq(schema.sellerProfiles.id, orden.sellerId))
    .limit(1);

  const items = await database
    .select({
      titulo: schema.orderItems.titleSnapshot,
      cantidad: schema.orderItems.quantity,
    })
    .from(schema.orderItems)
    .where(eq(schema.orderItems.orderId, orderId))
    .orderBy(asc(schema.orderItems.createdAt), asc(schema.orderItems.id));

  const [envio] = await database
    .select({
      transportista: schema.shipments.provider,
      trackingNumber: schema.shipments.trackingNumber,
    })
    .from(schema.shipments)
    .where(eq(schema.shipments.orderId, orderId))
    .limit(1);

  return {
    orderId: orden.orderId,
    orderNumber: orden.orderNumber,
    totalAmount: orden.totalAmount,
    sellerAmount: orden.sellerAmount,
    currency: orden.currency,
    buyer: {
      userId: orden.buyerId,
      email: orden.buyerEmail,
      displayName: orden.buyerDisplayName,
    },
    seller: vendedor,
    items: items.map((item) => ({ titulo: item.titulo, cantidad: item.cantidad })),
    envio,
  };
}
