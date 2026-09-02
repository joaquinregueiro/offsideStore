import { randomBytes } from 'node:crypto';

import type { Database } from '@offside/database';

import type { PublicUser } from '../../auth/services/auth.service';
import * as settingsService from '../../config/services/settings.service';
import * as listingService from '../../listings/services/listing.service';
import { canSellerOperate } from '../../sellers/services/mercadopago-connection.service';
import { requireOwnSellerProfile } from '../../sellers/services/seller.service';
import * as errors from '../orders.errors';
import * as orderRepo from '../repositories/order.repository';

/**
 * Ordenes — **alcance minimo**: crear una orden de compra directa y marcarla
 * pagada.
 *
 * ⚠️ TODAVIA NO ES EL MODULO COMPLETO. Falta: carrito, envios, descuentos,
 * ciclo logistico (SHIPPED/DELIVERED/COMPLETED), cancelacion, expiracion de la
 * ventana de pago y descuento de stock. Lo que hay alcanza para vender una
 * publicacion y cobrarla; el detalle de lo que se omitio y por que esta en
 * `createOrder()`.
 */

export type { OrderRow, OrderItemRow } from '../repositories/order.repository';

/**
 * Tasa de comision de Offside — **6%** (DEC-043, cierra DEC-007).
 *
 * ⚠️ ESTE VALOR ES PROVISIONAL EN CODIGO. Su lugar definitivo es el Config Store
 * (`app_settings.commission_rate_default`, DEC-013/DEC-038), que todavia no
 * existe. Se deja aca, en UNA constante y con nombre explicito, para que la
 * migracion al Config Store sea un cambio de una linea. **No copiar este valor
 * a ningun otro archivo.**
 *
 * Se expresa en base 10.000 (igual que `numeric(6,4)` del ERD) para no usar
 * `float` en un calculo de dinero.
 */
const BASIS_POINTS_TOTAL = 10_000n;

/**
 * Comision de Offside sobre el total cobrado al comprador (DEC-014 + DEC-043).
 *
 * ⚠️ FUNCION PURA, en centavos, sin `float`. El redondeo es **hacia abajo**
 * (division entera): ante un centavo en disputa, queda del lado del vendedor.
 * Es la opcion conservadora y la unica que no puede hacer que
 * `marketplace_fee > total`, cosa que Mercado Pago rechaza.
 *
 * NO incluye ni descuenta el costo de Mercado Pago: ese costo es independiente
 * y lo descuenta MP nativamente del lado del vendedor (DEC-043).
 */
export function calculateCommission(totalAmount: bigint, basisPoints: number): bigint {
  if (totalAmount <= 0n) return 0n;
  return (totalAmount * BigInt(basisPoints)) / BASIS_POINTS_TOTAL;
}

/** Orden con sus items, tal como la necesita el checkout. */
export interface OrderForPayment {
  order: orderRepo.OrderRow;
  items: orderRepo.OrderItemRow[];
}

export async function getOrderForPayment(orderId: string): Promise<OrderForPayment | null> {
  const order = await orderRepo.findById(orderId);
  if (order === undefined) return null;

  return { order, items: await orderRepo.findItems(orderId) };
}

export async function findById(orderId: string): Promise<orderRepo.OrderRow | undefined> {
  return orderRepo.findById(orderId);
}

/**
 * Transiciona la orden a `PAID` y deja rastro en `order_status_history`.
 *
 * Devuelve `false` si la orden ya no estaba en `PENDING_PAYMENT`: es el caso del
 * webhook duplicado y **no es un error**.
 */
/** Una publicacion cuyo stock no alcanzo. */
export interface StockShortage {
  listingId: string;
  requested: number;
}

/**
 * Descuenta el stock de las publicaciones de una orden.
 *
 * Se llama SOLO cuando el pago quedo aprobado (MF-022 / BR-022): agregar al
 * carrito no reserva stock, y reservarlo al crear la orden exigiria una
 * politica de expiracion que nadie decidio.
 *
 * Corre dentro de la MISMA transaccion que el paso de la orden a `PAID`, y
 * `markAsPaid` ya garantiza que eso ocurre una sola vez: un webhook repetido no
 * vuelve a descontar.
 *
 * ⚠️ NO LANZA cuando el stock no alcanza. Devuelve los faltantes para que quien
 * llama decida, porque a esta altura **el dinero ya se cobro** y que hacer con
 * un pago aprobado sin stock es una decision de negocio que no esta tomada
 * (ver `orders-and-refunds.md`; la doc cubre el caso en el checkout —UC-MF-3—
 * pero no despues del cobro).
 */
export async function decrementStockForOrder(
  orderId: string,
  db?: Database,
): Promise<StockShortage[]> {
  const items = await orderRepo.findItems(orderId, db);
  const faltantes: StockShortage[] = [];

  for (const item of items) {
    const restante = await listingService.decrementStock(item.listingId, item.quantity, db);
    if (restante === undefined) {
      faltantes.push({ listingId: item.listingId, requested: item.quantity });
    }
  }

  return faltantes;
}

/**
 * Hay stock suficiente para todos los items de la orden.
 *
 * Es una lectura, no una reserva: entre esta consulta y el cobro alguien puede
 * llevarse la ultima unidad. Por eso NO reemplaza al descuento atomico, lo
 * complementa: evita cobrar de mas en el caso comun (UC-MF-3).
 */
export async function hasStockForOrder(orderId: string, db?: Database): Promise<boolean> {
  const items = await orderRepo.findItems(orderId, db);

  for (const item of items) {
    const listing = await listingService.findById(item.listingId);
    if (listing === undefined || listing.stock < item.quantity) return false;
  }

  return true;
}

export async function markAsPaid(orderId: string, paidAt: Date, db?: Database): Promise<boolean> {
  const actualizada = await orderRepo.markAsPaid(orderId, paidAt, db);
  if (actualizada === undefined) return false;

  await orderRepo.appendStatusHistory(
    {
      orderId,
      fromStatus: 'PENDING_PAYMENT',
      toStatus: 'PAID',
      actorType: 'system',
      note: 'Pago aprobado por Mercado Pago',
    },
    db,
  );

  return true;
}

/* -------------------------------------------------------------------------- */
/* Creacion de la orden                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Numero de orden legible.
 *
 * `orders.order_number` es UNIQUE. 5 bytes en hexadecimal dan 10 caracteres y
 * suficiente entropia para que una colision sea despreciable; si igualara a una
 * existente, la restriccion de la base rechaza la insercion en vez de pisar
 * nada.
 */
function generateOrderNumber(): string {
  return `OFF-${randomBytes(5).toString('hex').toUpperCase()}`;
}

export interface CreateOrderInput {
  listingId: string;
  quantity: number;
  /** Snapshot, no FK: editar la libreta de direcciones no altera la orden. */
  shippingAddress: Record<string, unknown>;
}

export interface PublicOrder {
  id: string;
  orderNumber: string;
  status: orderRepo.OrderRow['status'];
  currency: string;
  productAmount: string;
  totalAmount: string;
  commissionAmount: string;
  sellerAmount: string;
  createdAt: string;
}

export function toPublicOrder(row: orderRepo.OrderRow): PublicOrder {
  return {
    id: row.id,
    orderNumber: row.orderNumber,
    status: row.status,
    currency: row.currency,
    productAmount: row.productAmount.toString(),
    totalAmount: row.totalAmount.toString(),
    commissionAmount: row.commissionAmount?.toString() ?? '0',
    sellerAmount: row.sellerAmount?.toString() ?? '0',
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Crea una orden a partir de UNA publicacion.
 *
 * ⚠️ ALCANCE MINIMO, deliberado. Lo que **no** hace, y por que:
 *
 *  - **No pasa por el carrito.** `cart` no existe; se compra directo. DEC-026
 *    (1 orden = 1 vendedor) se cumple trivialmente con un solo listing.
 *  - **No calcula envio.** `shipping_amount` queda en 0: el modulo `shipments`
 *    no existe y la tarifa de Correo Argentino sigue 🔵. No se inventa un costo.
 *  - **No aplica descuentos.** No hay motor de promociones (DEC-017 define quien
 *    los absorbe, no como se calculan).
 *  - **No descuenta stock.** Se descuenta cuando el pago se aprueba
 *    (MF-022 anti-overselling); reservarlo antes exigiria una politica de
 *    expiracion de reservas que nadie decidio.
 *  - **No fija `payment_deadline`.** El plazo es ⚙️ configurable y su valor
 *    sigue 🟡 (DEC-033).
 *
 * SNAPSHOT FINANCIERO (DEC-030): la comision se calcula y se CONGELA acá. El
 * pago la lee de la orden; nunca la recalcula.
 */
export async function createOrder(user: PublicUser, input: CreateOrderInput): Promise<PublicOrder> {
  const listing = await listingService.findById(input.listingId);

  if (listing === undefined || !listingService.isPurchasable(listing)) {
    throw errors.listingNotAvailable();
  }

  if (listing.stock < input.quantity) throw errors.listingOutOfStock();

  // El vendedor no puede comprarse a si mismo. Se compara contra el `user.id`
  // del comprador resolviendo el perfil del vendedor, no al reves.
  if ((await orderRepo.findSellerUserId(listing.sellerId)) === user.id) {
    throw errors.cannotBuyOwnListing();
  }

  // No tiene sentido armar una compra que despues no se va a poder cobrar.
  if (!(await canSellerOperate(listing.sellerId))) throw errors.sellerNotOperational();

  const productAmount = listing.priceAmount * BigInt(input.quantity);
  // Sin envio ni descuentos, el total es el producto. El CHECK de la tabla
  // (`total = producto - descuento + envio`) se cumple con ambos en 0.
  const totalAmount = productAmount;
  // La tasa sale del Config Store (DEC-007 / DEC-013), no de una constante.
  // Se lee UNA vez, aca, y a partir de este punto la que manda es la copia
  // congelada en la orden: `payments` nunca vuelve a consultarla (DEC-030).
  const basisPoints = await settingsService.getCommissionRateBasisPoints();
  const commissionAmount = calculateCommission(totalAmount, basisPoints);

  const { order } = await orderRepo.insertOrder(
    {
      orderNumber: generateOrderNumber(),
      buyerId: user.id,
      sellerId: listing.sellerId,
      currency: listing.currency,
      productAmount,
      totalAmount,
      commissionRateAtTransaction: settingsService.basisPointsToRateSnapshot(basisPoints),
      commissionAmount,
      sellerAmount: totalAmount - commissionAmount,
      shippingAddress: input.shippingAddress,
    },
    [
      {
        listingId: listing.id,
        titleSnapshot: listing.title,
        unitPriceAmount: listing.priceAmount,
        currency: listing.currency,
        quantity: input.quantity,
      },
    ],
  );

  return toPublicOrder(order);
}

/** Ordenes del comprador. */
export async function listMyOrders(user: PublicUser): Promise<PublicOrder[]> {
  const rows = await orderRepo.findByBuyerId(user.id);
  return rows.map(toPublicOrder);
}

/**
 * Ordenes recibidas por el vendedor autenticado (SS-070).
 *
 * AUTORIZACION: el perfil se resuelve POR `user.id` con el MISMO helper que usa
 * el resto del modulo `sellers`. No hay parametro de vendedor que manipular.
 *
 * Devuelve `PublicOrder`, que ya trae `commissionAmount` y `sellerAmount`: son
 * el snapshot congelado al crear la orden (DEC-030), no un calculo de ahora.
 *
 * ⚠️ NO INCLUYE LOS DATOS DEL COMPRADOR. SS-071 los pide para despachar, pero
 * el envio no existe todavia y exponer nombre y direccion sin una pantalla que
 * los use seria filtrar datos personales sin motivo.
 */
export async function listMySales(user: PublicUser): Promise<PublicOrder[]> {
  const seller = await requireOwnSellerProfile(user);
  const rows = await orderRepo.findBySellerId(seller.id);

  return rows.map(toPublicOrder);
}

/** Un item de la orden, tal como lo ve el comprador. */
export interface PublicOrderItem {
  id: string;
  /** Snapshot del titulo al momento de comprar (DEC-030). */
  title: string;
  quantity: number;
  unitPriceAmount: string;
}

export interface PublicOrderWithItems extends PublicOrder {
  items: PublicOrderItem[];
  /** Vencimiento de la ventana de pago, si la orden tiene una. */
  paymentDeadline: string | null;
}

/**
 * Una orden del comprador autenticado, con sus items.
 *
 * ⚠️ SE COMPARA CONTRA `user.id`, nunca contra un id que venga del request. Y
 * una orden ajena devuelve `null`, el MISMO resultado que una inexistente:
 * distinguirlos permitiria enumerar ordenes de otros. Es el mismo criterio que
 * ya usa `payments.startCheckout`.
 */
export async function getMyOrder(
  user: PublicUser,
  orderId: string,
): Promise<PublicOrderWithItems | null> {
  const order = await orderRepo.findById(orderId);
  if (order?.buyerId !== user.id) return null;

  const items = await orderRepo.findItems(orderId);

  return {
    ...toPublicOrder(order),
    paymentDeadline: order.paymentDeadline?.toISOString() ?? null,
    items: items.map((item) => ({
      id: item.id,
      title: item.titleSnapshot,
      quantity: item.quantity,
      unitPriceAmount: item.unitPriceAmount.toString(),
    })),
  };
}
