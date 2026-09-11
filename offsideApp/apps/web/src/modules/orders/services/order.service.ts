import { randomBytes } from 'node:crypto';

import { getDatabase, type Database } from '@offside/database';

import * as audit from '../../audit/services/audit.service';
import type { PublicUser } from '../../auth/services/auth.service';
import * as settingsService from '../../config/services/settings.service';
import * as listingService from '../../listings/services/listing.service';
import { activePromotionFor } from '../../listings/services/promotion.service';
import { shippingAmountFor } from '../../listings/services/shipping-declaration';
import { canSellerOperate } from '../../sellers/services/mercadopago-connection.service';
import { resolveCommissionBasisPoints } from '../../sellers/services/seller-tier.service';
import { requireOwnSellerProfile } from '../../sellers/services/seller.service';
import { requireCarrier } from '../../shipments/services/carrier-catalog.service';
import * as manualShipment from '../../shipments/services/manual-shipment.service';
import * as errors from '../orders.errors';
import * as orderRepo from '../repositories/order.repository';
import { emitOrderTransition } from './order-events';
import * as orderSettings from './order-settings.service';
import {
  canTransition,
  computePaymentDeadline,
  dispatchDeadlineFor,
  effectiveBasisPoints,
  hasProtectionWindowElapsed,
  isDispatchOverdue,
  protectionWindowEnd,
  toHistoryActorType,
  type OrderStatus,
  type TransitionActor,
} from './order-transitions';

/**
 * Ordenes: creacion con snapshot economico (DEC-030) y ciclo de vida
 * completo (DEC-029): `PENDING_PAYMENT → PAID → PROCESSING → SHIPPED →
 * DELIVERED → COMPLETED`, mas `CANCELLED`.
 *
 * Quien mueve cada estado:
 *
 *  - `PAID` y `PROCESSING`: el SISTEMA, desde la transaccion del webhook de
 *    Mercado Pago (`payments.aplicarAprobacion` llama `markAsPaid` y despues
 *    `decrementStockForOrder`; la segunda es la que pasa a `PROCESSING`).
 *  - `SHIPPED`: el VENDEDOR con `markShipped` (despacho manual, SH-010).
 *  - `DELIVERED`: el COMPRADOR con `confirmDelivered`. ⚠️ ASUMIDO: la doc lo
 *    deriva del tracking de Correo Argentino, que no existe.
 *  - `COMPLETED`: el SISTEMA, al vencer la proteccion sin reclamo
 *    (`completeIfWindowElapsed`, BR-033 / MF-040).
 *  - `CANCELLED`: el comprador sin pagar, el sistema al vencer la ventana de
 *    pago (`order-jobs.service.ts`), o el vendedor antes de despachar.
 *
 * Lo que sigue sin existir: carrito, disputas (se consultan por SQL para no
 * cerrar una orden con reclamo abierto), y el refund que una cancelacion del
 * vendedor obliga: queda auditado y lo ejecuta `payments` desde el back-office.
 */

export type { OrderRow, OrderItemRow } from '../repositories/order.repository';
export type { OrderStatus, TransitionActor } from './order-transitions';

/**
 * Base de los basis points: 600 bp = 6%. Se expresa en base 10.000 (igual que
 * `numeric(6,4)` del ERD) para no usar `float` en un calculo de dinero.
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

/* -------------------------------------------------------------------------- */
/* Pago aprobado: PAID y PROCESSING                                            */
/* -------------------------------------------------------------------------- */

/** Una publicacion cuyo stock no alcanzo. */
export interface StockShortage {
  listingId: string;
  requested: number;
}

/**
 * Descuenta el stock de las publicaciones de una orden y, si alcanzo para
 * todas, pasa la orden de `PAID` a `PROCESSING`.
 *
 * Se llama SOLO cuando el pago quedo aprobado (MF-022 / BR-022): agregar al
 * carrito no reserva stock, y reservarlo al crear la orden exigiria una
 * politica de expiracion que nadie decidio.
 *
 * Corre dentro de la MISMA transaccion que el paso de la orden a `PAID`, y
 * `markAsPaid` ya garantiza que eso ocurre una sola vez: un webhook repetido no
 * vuelve a descontar.
 *
 * ⚠️ `PAID → PROCESSING` VA ACA Y NO EN `markAsPaid`, porque recien despues de
 * descontar se sabe si hubo faltantes, y `payments` llama a las dos funciones
 * en ese orden dentro de su transaccion (`aplicarAprobacion`). Con todo el
 * stock descontado la orden entra en `PROCESSING` en el mismo commit y ahi
 * arranca el plazo de despacho (MF-030), que corre desde `paid_at`. ⚠️ No
 * hay columna `processing_at` en el ERD: el instante queda en
 * `order_status_history`.
 *
 * ⚠️ CON FALTANTES NO LANZA y la orden QUEDA EN `PAID`: a esta altura **el
 * dinero ya se cobro** y que hacer con un pago aprobado sin stock es una
 * decision de negocio que no esta tomada (la doc cubre el caso en el checkout
 * —UC-MF-3— pero no despues del cobro). `payments` deja el rastro en
 * `audit_log` y el back-office la ve en `listPaidWithoutStock()`. No corre el
 * plazo de despacho: no hay nada que despachar.
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
      continue;
    }

    /**
     * SS-051 — sin stock, la publicacion pasa a AGOTADA automaticamente.
     *
     * ⚠️ VA ACA Y NO EN UN BARRIDO POSTERIOR: este es el unico punto donde el
     * stock baja, y hacerlo en la MISMA transaccion que el descuento evita la
     * ventana en la que la vitrina ofrece algo que ya no existe.
     *
     * ⚠️ `isPurchasable` ya exige `stock >= 1`, asi que esto no cambia si algo
     * se puede comprar: cambia lo que el VENDEDOR ve en su inventario, que es
     * lo que SS-051 pide.
     */
    if (restante === 0) {
      await listingService.markSoldOut(item.listingId, db);
    }
  }

  if (faltantes.length === 0) await startProcessing(orderId, db);

  return faltantes;
}

/**
 * `PAID → PROCESSING`. Condicionado al estado de origen: si la orden no esta
 * en `PAID` (webhook repetido, orden ya cancelada por un admin) no escribe
 * nada. Devuelve `true` si transiciono.
 */
export async function startProcessing(orderId: string, db?: Database): Promise<boolean> {
  const actualizada = await orderRepo.transitionStatus(orderId, 'PAID', 'PROCESSING', {}, db);
  if (actualizada === undefined) return false;

  await orderRepo.appendStatusHistory(
    {
      orderId,
      fromStatus: 'PAID',
      toStatus: 'PROCESSING',
      actorType: 'system',
      note: 'Stock descontado. Corre el plazo de despacho del vendedor',
    },
    db,
  );

  return true;
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

/**
 * Transiciona la orden a `PAID` y deja rastro en `order_status_history`.
 *
 * Devuelve `false` si la orden ya no estaba en `PENDING_PAYMENT`: es el caso del
 * webhook duplicado y **no es un error**. El paso siguiente a `PROCESSING` lo
 * hace `decrementStockForOrder`, que `payments` llama a continuacion.
 */
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

/** Una linea de una orden de varios articulos (la del carrito). */
export interface OrderLineInput {
  listingId: string;
  quantity: number;
}

export interface CreateMultiOrderInput {
  /** Todas del MISMO vendedor (DEC-026). Al menos una. */
  items: OrderLineInput[];
  shippingAddress: Record<string, unknown>;
}

/**
 * De donde sale la comision de esta orden. Lo resuelven OTROS modulos
 * (`sellers.resolveCommissionBasisPoints` para el tier,
 * `listings.activePromotionFor` para la promocion) y lo reciben por parametro:
 * `orders` no decide tasas, las congela.
 */
export interface CommissionResolution {
  /** Tasa BASE en basis points (del tier o la global). */
  basisPoints: number;
  /** `seller_tiers.code` vigente al vender, o null si no tenia tier. */
  tierCode: string | null;
  /** `promotion_commission_multiplier` si la publicacion estaba promocionada. */
  promotionMultiplier: number | null;
  /** `listing_promotions.id` que agrava la comision, si hay. */
  promotionId: string | null;
  source: 'default' | 'seller_tier' | 'promoted';
}

export interface CreateOrderOptions {
  /** Si no viene: la tasa global de `app_settings`, sin tier ni promocion. */
  commission?: CommissionResolution | undefined;
  /** Costo de envio a congelar (SH-011, `listings.shippingAmountFor`). 0 si no viene. */
  shippingAmount?: bigint | undefined;
}

export interface PublicOrder {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  currency: string;
  productAmount: string;
  shippingAmount: string;
  totalAmount: string;
  commissionAmount: string;
  sellerAmount: string;
  createdAt: string;
  paidAt: string | null;
  shippedAt: string | null;
  deliveredAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  /**
   * POR QUE la comision fue la que fue, del SNAPSHOT de la orden (DEC-030).
   *
   * ⚠️ SE EXPONE PARA QUE LA PANTALLA NO LO RECONSTRUYA. El panel del vendedor
   * muestra "nivel Plata 5 %" o "promocionada ×3" al lado del importe;
   * derivarlo de la configuracion de HOY daria una respuesta distinta cada vez
   * que alguien cambie una tasa, que es exactamente lo que DEC-030 prohibe.
   */
  commissionSource: string;
  /** Tasa congelada, como fraccion (`'0.0600'`). */
  commissionRateAtTransaction: string | null;
  /** `seller_tiers.code` que rigio al vender, o `null` si no tenia nivel. */
  sellerTierCodeAtTransaction: string | null;
  /** Multiplicador de la promocion (`'3.000'`), o `null` si no estaba promocionada. */
  promotionMultiplierAtTransaction: string | null;
}

export function toPublicOrder(row: orderRepo.OrderRow): PublicOrder {
  return {
    id: row.id,
    orderNumber: row.orderNumber,
    status: row.status,
    currency: row.currency,
    productAmount: row.productAmount.toString(),
    shippingAmount: row.shippingAmount.toString(),
    totalAmount: row.totalAmount.toString(),
    commissionAmount: row.commissionAmount?.toString() ?? '0',
    sellerAmount: row.sellerAmount?.toString() ?? '0',
    createdAt: row.createdAt.toISOString(),
    paidAt: row.paidAt?.toISOString() ?? null,
    shippedAt: row.shippedAt?.toISOString() ?? null,
    deliveredAt: row.deliveredAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    commissionSource: row.commissionSource,
    commissionRateAtTransaction: row.commissionRateAtTransaction,
    sellerTierCodeAtTransaction: row.sellerTierCodeAtTransaction,
    promotionMultiplierAtTransaction: row.promotionMultiplierAtTransaction,
  };
}

/**
 * Crea una orden a partir de UNA publicacion.
 *
 * Lo que **no** hace, y por que:
 *
 *  - **No pasa por el carrito.** `cart` no existe; se compra directo. DEC-026
 *    (1 orden = 1 vendedor) se cumple trivialmente con un solo listing.
 *  - **No cotiza envio.** `shipping_amount` es lo que `opciones.shippingAmount`
 *    diga —lo resuelve `listings.shippingAmountFor` a partir de lo que el
 *    vendedor declaro— o 0. Correo Argentino sigue 🔵.
 *  - **No aplica descuentos.** No hay motor de promociones de precio (DEC-017
 *    define quien los absorbe, no como se calculan).
 *  - **No descuenta stock.** Se descuenta cuando el pago se aprueba
 *    (MF-022 anti-overselling).
 *
 * SNAPSHOT ECONOMICO (DEC-030): la comision se calcula y se CONGELA aca, junto
 * con POR QUE fue esa —tier, multiplicador de promocion, origen—. El pago la
 * lee de la orden; nunca la recalcula. La tasa efectiva es la base por el
 * multiplicador, redondeada al basis point (`effectiveBasisPoints`), para que
 * `commission_rate_at_transaction` explique `commission_amount` exactamente.
 *
 * VENTANA DE PAGO (DEC-033): `payment_deadline = now + payment_window_minutes`.
 * El plazo sale del Config Store; el instante queda congelado en la orden.
 */
/**
 * La comision que le corresponde a ESTA venta: la tasa del vendedor, agravada
 * si la publicacion esta promocionada.
 *
 * ⚠️ `source` DISTINGUE TRES ORIGENES Y SE GUARDA EN LA ORDEN
 * (`commission_source`). Sin eso, dentro de seis meses nadie puede explicar
 * por que dos ventas del mismo vendedor cobraron distinto: la respuesta esta
 * repartida entre `seller_tiers` —que puede haber cambiado—, `app_settings`
 * —que puede haber cambiado— y una promocion que ya vencio. Con el origen
 * escrito, la orden se explica sola.
 *
 * ⚠️ UNA PROMOCION VENCIDA NO AGRAVA NADA: `activePromotionFor` mira
 * `ends_at`, no solo el `status`, porque el barrido que la cierra puede no
 * haber corrido todavia.
 *
 * ⚠️ SI ALGO FALLA, NO SE INVENTA UNA TASA. Se propaga: cobrar la global
 * "por las dudas" le cobraria de mas a un vendedor con tier, y cobrar la del
 * tier ignorando una promocion vigente nos cobraria de menos a nosotros.
 */
async function resolverComision(
  sellerId: string,
  listingId: string,
): Promise<CommissionResolution> {
  const [tasa, promocion] = await Promise.all([
    resolveCommissionBasisPoints(sellerId),
    activePromotionFor(listingId),
  ]);

  return {
    basisPoints: tasa.basisPoints,
    tierCode: tasa.tierCode,
    promotionMultiplier: promocion?.multiplier ?? null,
    promotionId: promocion?.id ?? null,
    source: promocion !== null ? 'promoted' : tasa.source,
  };
}

/**
 * Crea UNA orden con VARIOS articulos del mismo vendedor (DEC-026).
 *
 * Es lo que el carrito necesita: dos camisetas de la misma tienda son una
 * compra, no dos. `createOrder` queda como el caso de un solo articulo y le
 * delega a esta.
 *
 * ⚠️ TODAS LAS PUBLICACIONES TIENEN QUE SER DEL MISMO VENDEDOR, y no es una
 * comodidad de implementacion: DEC-026 lo exige porque cada orden se cobra
 * sobre la cuenta de Mercado Pago de SU vendedor con un `marketplace_fee`
 * propio. Una orden de dos vendedores no tendria a quien cobrarle.
 *
 * ⚠️ UNA ORDEN DE VARIOS ARTICULOS NO LLEVA PROMOCION. El snapshot tiene UN
 * `listing_promotion_id` y UN multiplicador (delta §10): aplicarlo a toda la
 * orden le cobraria comision agravada a articulos que nadie promociono, y
 * aplicarlo a una parte dejaria un `commission_rate_at_transaction` que no
 * reproduce el importe cobrado —o sea, un snapshot que miente—. Quien arma la
 * compra (el carrito) separa cada publicacion promocionada en su propia orden;
 * asi el vendedor paga exactamente lo que contrato y el snapshot cierra.
 *
 * ⚠️ EL ENVIO NO SE SUMA POR ARTICULO. Se cobra el MAYOR de los declarados:
 * mandar dos camisetas en el mismo paquete no cuesta dos envios, y cobrarlo
 * dos veces seria cobrar de mas. Es una decision asumida (2026-09-11,
 * confirmar): sin Correo Argentino no hay cotizacion real por peso.
 */
export async function createOrderForSeller(
  user: PublicUser,
  input: CreateMultiOrderInput,
  opciones: CreateOrderOptions = {},
): Promise<PublicOrder> {
  if (input.items.length === 0) throw new Error('una orden necesita al menos un articulo');

  const listings = await Promise.all(
    input.items.map(async (linea) => {
      const listing = await listingService.findById(linea.listingId);

      if (listing === undefined || !listingService.isPurchasable(listing)) {
        throw errors.listingNotAvailable();
      }
      if (listing.stock < linea.quantity) throw errors.listingOutOfStock();

      return { listing, quantity: linea.quantity };
    }),
  );

  const primera = listings[0]!.listing;
  if (listings.some(({ listing }) => listing.sellerId !== primera.sellerId)) {
    throw new Error('una orden no puede tener publicaciones de dos vendedores (DEC-026)');
  }

  if ((await orderRepo.findSellerUserId(primera.sellerId)) === user.id) {
    throw errors.cannotBuyOwnListing();
  }

  if (!(await canSellerOperate(primera.sellerId))) throw errors.sellerNotOperational();

  const shippingAmount =
    opciones.shippingAmount ??
    listings.reduce((mayor, { listing }) => {
      const costo = shippingAmountFor(listing);

      return costo > mayor ? costo : mayor;
    }, 0n);

  if (shippingAmount < 0n) throw new Error('shippingAmount no puede ser negativo');

  const productAmount = listings.reduce(
    (suma, { listing, quantity }) => suma + listing.priceAmount * BigInt(quantity),
    0n,
  );
  const totalAmount = productAmount + shippingAmount;

  /*
   * Con un solo articulo la promocion SI cuenta: es el caso de la compra
   * directa desde la ficha, que es donde el vendedor la contrato. Con varios,
   * ver el encabezado.
   */
  const unicoArticulo = listings.length === 1 ? primera.id : null;
  const comision: CommissionResolution =
    opciones.commission ??
    (unicoArticulo === null
      ? await resolverComisionSinPromocion(primera.sellerId)
      : await resolverComision(primera.sellerId, unicoArticulo));

  const basisPoints = effectiveBasisPoints(
    comision.basisPoints,
    comision.promotionMultiplier ?? undefined,
  );
  const commissionAmount = calculateCommission(totalAmount, basisPoints);

  const paymentDeadline = computePaymentDeadline(
    new Date(),
    await orderSettings.getPaymentWindowMinutes(),
  );

  const { order } = await orderRepo.insertOrder(
    {
      orderNumber: generateOrderNumber(),
      buyerId: user.id,
      sellerId: primera.sellerId,
      currency: primera.currency,
      productAmount,
      shippingAmount,
      totalAmount,
      commissionRateAtTransaction: settingsService.basisPointsToRateSnapshot(basisPoints),
      commissionAmount,
      sellerAmount: totalAmount - commissionAmount,
      sellerTierCodeAtTransaction: comision.tierCode,
      promotionMultiplierAtTransaction:
        comision.promotionMultiplier === null ? null : comision.promotionMultiplier.toFixed(3),
      commissionSource: comision.source,
      listingPromotionId: comision.promotionId,
      shippingAddress: input.shippingAddress,
      paymentDeadline,
    },
    listings.map(({ listing, quantity }) => ({
      listingId: listing.id,
      titleSnapshot: listing.title,
      unitPriceAmount: listing.priceAmount,
      currency: listing.currency,
      quantity,
    })),
  );

  return toPublicOrder(order);
}

/** La tasa del vendedor, sin mirar promociones. */
async function resolverComisionSinPromocion(sellerId: string): Promise<CommissionResolution> {
  const tasa = await resolveCommissionBasisPoints(sellerId);

  return {
    basisPoints: tasa.basisPoints,
    tierCode: tasa.tierCode,
    promotionMultiplier: null,
    promotionId: null,
    source: tasa.source,
  };
}

export async function createOrder(
  user: PublicUser,
  input: CreateOrderInput,
  opciones: CreateOrderOptions = {},
): Promise<PublicOrder> {
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

  /*
   * ⚠️ EL ENVIO Y LA COMISION SE RESUELVEN ACA ADENTRO, no en quien llama.
   * La pantalla de comprar y el carrito solo saben que publicacion y cuantas
   * unidades; que el vendedor este en un tier con menos comision o que la
   * publicacion este promocionada no es algo que la UI tenga que averiguar —y
   * si tuviera que hacerlo, el dia que alguien llame `createOrder` desde otro
   * lado se cobraria la tasa equivocada sin que falle nada—. Los parametros de
   * `opciones` siguen existiendo para los tests y para un llamador que ya los
   * resolvio.
   */
  const shippingAmount = opciones.shippingAmount ?? shippingAmountFor(listing);
  if (shippingAmount < 0n) throw new Error('shippingAmount no puede ser negativo');

  const productAmount = listing.priceAmount * BigInt(input.quantity);
  // Sin descuentos, el total es producto + envio. El CHECK de la tabla
  // (`total = producto - descuento + envio`) se cumple con descuento 0.
  const totalAmount = productAmount + shippingAmount;

  // La tasa sale del Config Store (DEC-007 / DEC-013) o de lo que resolvio
  // `sellers`/`listings` y llego por parametro. Se lee UNA vez, aca, y a partir
  // de este punto la que manda es la copia congelada en la orden: `payments`
  // nunca vuelve a consultarla (DEC-030).
  const comision: CommissionResolution =
    opciones.commission ?? (await resolverComision(listing.sellerId, listing.id));

  const basisPoints = effectiveBasisPoints(
    comision.basisPoints,
    comision.promotionMultiplier ?? undefined,
  );
  const commissionAmount = calculateCommission(totalAmount, basisPoints);

  const paymentDeadline = computePaymentDeadline(
    new Date(),
    await orderSettings.getPaymentWindowMinutes(),
  );

  const { order } = await orderRepo.insertOrder(
    {
      orderNumber: generateOrderNumber(),
      buyerId: user.id,
      sellerId: listing.sellerId,
      currency: listing.currency,
      productAmount,
      shippingAmount,
      totalAmount,
      commissionRateAtTransaction: settingsService.basisPointsToRateSnapshot(basisPoints),
      commissionAmount,
      sellerAmount: totalAmount - commissionAmount,
      sellerTierCodeAtTransaction: comision.tierCode,
      promotionMultiplierAtTransaction:
        comision.promotionMultiplier === null ? null : comision.promotionMultiplier.toFixed(3),
      commissionSource: comision.source,
      listingPromotionId: comision.promotionId,
      shippingAddress: input.shippingAddress,
      paymentDeadline,
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

/* -------------------------------------------------------------------------- */
/* Listas                                                                      */
/* -------------------------------------------------------------------------- */

/** Filtro de las listas. `estado` acota a un estado; sin el, todas. */
export interface OrderListFilter {
  estado?: OrderStatus | undefined;
}

/** Ordenes del comprador, mas nueva primero. */
export async function listMyOrders(
  user: PublicUser,
  filtro: OrderListFilter = {},
): Promise<PublicOrderConItems[]> {
  const rows = await orderRepo.findByBuyerId(user.id, undefined, { status: filtro.estado });

  return conItems(rows);
}

/**
 * Le pega los items a una lista de ordenes.
 *
 * ⚠️ UNA SOLA CONSULTA PARA TODA LA LISTA, no una por orden. Es el mismo
 * problema N+1 que la vitrina ya resuelve con las portadas.
 *
 * ⚠️ POR QUE HACE FALTA: "Mis compras" era una lista de codigos
 * `OFF-XXXXXXXXXX`. Nadie recuerda una compra por su numero de orden; la
 * recuerda por la camiseta. El titulo esta CONGELADO en `order_items`
 * (DEC-030), asi que mostrarlo no reintroduce ninguna dependencia con la
 * publicacion actual: si el vendedor le cambio el nombre despues, la orden
 * sigue diciendo lo que se compro.
 */
async function conItems(rows: orderRepo.OrderRow[]): Promise<PublicOrderConItems[]> {
  const items = await orderRepo.findItemsByOrderIds(rows.map((row) => row.id));
  const porOrden = new Map<string, PublicOrderItem[]>();

  for (const item of items) {
    const lista = porOrden.get(item.orderId) ?? [];
    lista.push(toPublicItem(item));
    porOrden.set(item.orderId, lista);
  }

  return rows.map((row) => ({ ...toPublicOrder(row), items: porOrden.get(row.id) ?? [] }));
}

function toPublicItem(item: orderRepo.OrderItemRow): PublicOrderItem {
  return {
    id: item.id,
    listingId: item.listingId,
    title: item.titleSnapshot,
    quantity: item.quantity,
    unitPriceAmount: item.unitPriceAmount.toString(),
  };
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
 * ⚠️ NO INCLUYE LOS DATOS DEL COMPRADOR. SS-071 los pide para despachar y los
 * da `getSaleDetail`, orden por orden: una lista con nombres y direcciones de
 * todos los compradores es mas de lo que hace falta para despachar uno.
 */
export async function listMySales(
  user: PublicUser,
  filtro: OrderListFilter = {},
): Promise<PublicOrderConItems[]> {
  const seller = await requireOwnSellerProfile(user);
  const rows = await orderRepo.findBySellerId(seller.id, undefined, { status: filtro.estado });

  return conItems(rows);
}

/**
 * Orden por su numero visible. Para el back-office.
 *
 * ⚠️ NO AUTORIZA. Devuelve la orden de cualquiera: quien llama tiene que
 * haber verificado la capacidad administrativa primero. Se llama distinto que
 * `getMyOrder` justamente para que la diferencia se vea en el punto de uso.
 */
export async function findByOrderNumber(orderNumber: string): Promise<PublicOrder | null> {
  const row = await orderRepo.findByOrderNumber(orderNumber);

  return row === undefined ? null : toPublicOrder(row);
}

/**
 * Ordenes pagadas que se quedaron sin stock para cumplir (`PAID` sin pasar a
 * `PROCESSING`). Para el back-office: cada una tiene un pago aprobado y nada
 * que despachar, y resolverlas —refund, reposicion— es una decision manual.
 *
 * ⚠️ NO AUTORIZA, como `findByOrderNumber`. Con `limite` porque es una cola
 * de trabajo, no un reporte.
 */
export async function listPaidWithoutStock(limite = 50): Promise<PublicOrderConItems[]> {
  return conItems(await orderRepo.findStuckInPaid(limite));
}

/** Un item de la orden, tal como lo ve el comprador. */
export interface PublicOrderItem {
  id: string;
  /**
   * Publicacion comprada.
   *
   * ⚠️ SIRVE PARA BUSCAR LA FOTO Y PARA ENLAZAR, NO COMO FUENTE DE VERDAD DEL
   * DATO. El titulo y el precio de la orden son el snapshot congelado; la
   * publicacion actual puede haber cambiado los dos, o estar eliminada.
   */
  listingId: string;
  /** Snapshot del titulo al momento de comprar (DEC-030). */
  title: string;
  quantity: number;
  unitPriceAmount: string;
}

/** Una orden de lista, con lo suficiente para decir QUE se compro. */
export interface PublicOrderConItems extends PublicOrder {
  items: PublicOrderItem[];
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
    items: items.map(toPublicItem),
  };
}

/* -------------------------------------------------------------------------- */
/* Fichas: linea de tiempo, ventanas, detalle de compra y de venta             */
/* -------------------------------------------------------------------------- */

/** Una transicion del historial, para la linea de tiempo. */
export interface TimelineEntry {
  fromStatus: OrderStatus | null;
  toStatus: OrderStatus;
  actorType: 'user' | 'seller' | 'admin' | 'system';
  /** Nombre visible de quien lo hizo; null para el sistema o si no lo cargo. */
  actorDisplayName: string | null;
  note: string | null;
  createdAt: string;
}

/**
 * Linea de tiempo de la orden, del mas viejo al mas nuevo.
 *
 * ⚠️ NO AUTORIZA: `getMyOrderDetail` y `getSaleDetail` la incluyen ya
 * autorizada. Suelta es para el back-office, que verifica capacidad antes.
 */
export async function getOrderTimeline(orderId: string): Promise<TimelineEntry[]> {
  const historial = await orderRepo.findStatusHistory(orderId);

  return historial.map((h) => ({
    fromStatus: h.fromStatus,
    toStatus: h.toStatus,
    actorType: h.actorType,
    actorDisplayName: h.actorDisplayName,
    note: h.note,
    createdAt: h.createdAt.toISOString(),
  }));
}

/** El plazo de despacho de una orden (BR-032) y si ya paso. */
export interface DispatchDeadline {
  /** Null si la orden nunca se pago. */
  deadline: string | null;
  /** Sigue en `PROCESSING` y el plazo ya paso. */
  overdue: boolean;
}

/**
 * Plazo de despacho: `paid_at + dispatch_deadline_hours`. Se calcula, no se
 * persiste (ver `dispatchDeadlineFor`): cambiar la configuracion mueve el
 * plazo de las ordenes en curso, que es lo esperable de un plazo operativo.
 */
export async function getDispatchDeadline(
  order: Pick<orderRepo.OrderRow, 'status' | 'paidAt'>,
  now: Date = new Date(),
): Promise<DispatchDeadline> {
  const horas = await orderSettings.getDispatchDeadlineHours();
  const deadline = dispatchDeadlineFor(order.paidAt, horas);

  return {
    deadline: deadline?.toISOString() ?? null,
    overdue: isDispatchOverdue(order, horas, now),
  };
}

/** Las ventanas que gobiernan la orden, ya resueltas contra la configuracion. */
export interface OrderWindows {
  /** Hasta cuando se puede pagar (DEC-033). */
  paymentDeadline: string | null;
  /** Hasta cuando el vendedor tiene que despachar (BR-032). */
  dispatchDeadline: string | null;
  dispatchOverdue: boolean;
  /** Fin de la proteccion al comprador desde la entrega (BR-033/034). */
  protectionEndsAt: string | null;
}

async function ventanasDe(order: orderRepo.OrderRow, now: Date): Promise<OrderWindows> {
  const despacho = await getDispatchDeadline(order, now);

  let protectionEndsAt: string | null = null;
  if (order.deliveredAt !== null) {
    const dias = await orderSettings.getBuyerProtectionDays();
    protectionEndsAt = protectionWindowEnd(order.deliveredAt, dias).toISOString();
  }

  return {
    paymentDeadline: order.paymentDeadline?.toISOString() ?? null,
    dispatchDeadline: despacho.deadline,
    dispatchOverdue: despacho.overdue,
    protectionEndsAt,
  };
}

/** Ficha de una compra, para el comprador. */
export interface MyOrderDetail extends PublicOrderWithItems {
  /**
   * La direccion a la que se envio, del SNAPSHOT de la orden.
   *
   * ⚠️ NO SE LEE DE LA LIBRETA DE DIRECCIONES, y es la razon por la que esta
   * acá y no la resuelve la pantalla. La libreta cambia —alguien se muda, la
   * edita, la borra— y la orden viajo a la direccion que tenia ese dia.
   * Mostrar la actual seria contarle a la persona una historia falsa sobre una
   * compra que ya ocurrio, que es el mismo motivo por el que el importe y la
   * comision tambien se congelan (DEC-030).
   */
  shippingAddress: Record<string, unknown>;
  /** Nombre de la tienda que vendio. Para no decir "el vendedor" a secas. */
  sellerDisplayName: string | null;
  shipment: manualShipment.PublicShipment | null;
  windows: OrderWindows;
  timeline: TimelineEntry[];
  /** Lo que el comprador puede hacer ahora, segun la maquina de estados. */
  actions: { canCancel: boolean; canConfirmDelivery: boolean; canPay: boolean };
}

/**
 * La compra con su envio, sus plazos y su linea de tiempo. Misma regla de
 * autorizacion que `getMyOrder`: ajena = inexistente = `null`.
 */
export async function getMyOrderDetail(
  user: PublicUser,
  orderId: string,
  now: Date = new Date(),
): Promise<MyOrderDetail | null> {
  const order = await orderRepo.findById(orderId);
  if (order?.buyerId !== user.id) return null;

  const [items, shipment, windows, timeline, vendedor] = await Promise.all([
    orderRepo.findItems(orderId),
    manualShipment.getShipmentForOrder(orderId),
    ventanasDe(order, now),
    getOrderTimeline(orderId),
    orderRepo.findSellerDisplayName(order.sellerId),
  ]);

  const paymentDeadline = order.paymentDeadline?.toISOString() ?? null;

  return {
    ...toPublicOrder(order),
    paymentDeadline,
    items: items.map(toPublicItem),
    shippingAddress: order.shippingAddress as Record<string, unknown>,
    sellerDisplayName: vendedor ?? null,
    shipment,
    windows,
    timeline,
    actions: {
      canCancel: canTransition(order.status, 'CANCELLED', 'buyer'),
      canConfirmDelivery: canTransition(order.status, 'DELIVERED', 'buyer'),
      canPay:
        order.status === 'PENDING_PAYMENT' &&
        (order.paymentDeadline === null || order.paymentDeadline.getTime() > now.getTime()),
    },
  };
}

/** Ficha de una venta, para el vendedor (SS-070 / SS-071). */
export interface SaleDetail extends PublicOrderConItems {
  /** Datos del comprador para despachar (SS-071). Solo aca, nunca en la lista. */
  buyer: { displayName: string | null; shippingAddress: Record<string, unknown> };
  shipment: manualShipment.PublicShipment | null;
  windows: OrderWindows;
  timeline: TimelineEntry[];
  actions: { canShip: boolean; canCancel: boolean };
}

/**
 * La venta con lo que hace falta para despacharla. Ajena = inexistente = `null`.
 *
 * ⚠️ ES EL UNICO LUGAR DONDE EL VENDEDOR VE NOMBRE Y DIRECCION DEL COMPRADOR,
 * y solo de una orden que es suya y que ya se pago o esta en curso: un
 * vendedor con una orden `PENDING_PAYMENT` todavia no tiene nada que
 * despachar, y una direccion sin motivo es un dato personal filtrado.
 */
export async function getSaleDetail(
  user: PublicUser,
  orderId: string,
  now: Date = new Date(),
): Promise<SaleDetail | null> {
  const seller = await requireOwnSellerProfile(user);
  const order = await orderRepo.findById(orderId);
  if (order?.sellerId !== seller.id) return null;

  const [items, shipment, windows, timeline, displayName] = await Promise.all([
    orderRepo.findItems(orderId),
    manualShipment.getShipmentForOrder(orderId),
    ventanasDe(order, now),
    getOrderTimeline(orderId),
    orderRepo.findBuyerDisplayName(order.buyerId),
  ]);

  const mostrarComprador = order.status !== 'PENDING_PAYMENT' && order.status !== 'CANCELLED';

  return {
    ...toPublicOrder(order),
    items: items.map(toPublicItem),
    buyer: mostrarComprador
      ? {
          displayName: displayName ?? null,
          shippingAddress: (order.shippingAddress ?? {}) as Record<string, unknown>,
        }
      : { displayName: null, shippingAddress: {} },
    shipment,
    windows,
    timeline,
    actions: {
      canShip: canTransition(order.status, 'SHIPPED', 'seller'),
      canCancel: canTransition(order.status, 'CANCELLED', 'seller'),
    },
  };
}

/** Cuantas ventas recibio el vendedor autenticado, por estado. */
export interface ResumenDeVentas {
  /** Ordenes que ya se cobraron: `PAID` en adelante, sin contar canceladas. */
  cobradas: number;
  /** Creadas pero todavia sin pagar. */
  esperandoPago: number;
  total: number;
}

/**
 * Resumen de ventas para el panel del vendedor.
 *
 * ⚠️ "COBRADAS" ES TODO LO QUE PASO POR `PAID`, no solo lo que esta en `PAID`
 * ahora: una orden entregada sigue contando como venta cobrada.
 */
export async function countMySales(user: PublicUser): Promise<ResumenDeVentas> {
  const porEstado = await countSalesByStatus(user);

  return {
    cobradas:
      porEstado.PAID +
      porEstado.PROCESSING +
      porEstado.SHIPPED +
      porEstado.DELIVERED +
      porEstado.COMPLETED,
    esperandoPago: porEstado.PENDING_PAYMENT,
    total: Object.values(porEstado).reduce((suma, n) => suma + n, 0),
  };
}

/** Ventas del vendedor autenticado por estado, con los siete siempre presentes. */
export async function countSalesByStatus(user: PublicUser): Promise<Record<OrderStatus, number>> {
  const seller = await requireOwnSellerProfile(user);
  const filas = await orderRepo.countBySellerId(seller.id);

  const conteo: Record<OrderStatus, number> = {
    PENDING_PAYMENT: 0,
    PAID: 0,
    PROCESSING: 0,
    SHIPPED: 0,
    DELIVERED: 0,
    COMPLETED: 0,
    CANCELLED: 0,
  };
  for (const fila of filas) conteo[fila.status] = fila.cantidad;

  return conteo;
}

/* -------------------------------------------------------------------------- */
/* Transiciones posteriores a PROCESSING                                       */
/* -------------------------------------------------------------------------- */

/**
 * Quien ejecuta una transicion: el rol en la orden y, si es una persona, su
 * `users.id` para el historial.
 */
export interface OrderActor {
  type: TransitionActor;
  userId?: string | undefined;
}

export const SYSTEM_ACTOR: OrderActor = { type: 'system' };

/**
 * Ejecuta una transicion validada por la maquina de estados, escribe el
 * historial y anuncia el evento DESPUES del commit.
 *
 * Es el unico camino para mover una orden desde este Service (salvo `PAID` y
 * `PROCESSING`, que corren dentro de la transaccion de `payments`). Recibe
 * `extra` para lo que cada transicion escribe ademas —el envio, el stock, la
 * auditoria— dentro de la MISMA transaccion.
 */
async function transicionar(
  order: orderRepo.OrderRow,
  to: OrderStatus,
  actor: OrderActor,
  opciones: {
    accion: string;
    note: string;
    timestamps: orderRepo.TransitionTimestamps;
    extra?: ((tx: Database, actualizada: orderRepo.OrderRow) => Promise<void>) | undefined;
    db?: Database | undefined;
  },
): Promise<orderRepo.OrderRow> {
  if (!canTransition(order.status, to, actor.type)) {
    throw errors.orderInvalidTransition(opciones.accion);
  }

  const ejecutar = async (tx: Database): Promise<orderRepo.OrderRow> => {
    // El WHERE del repository exige el estado de origen: si alguien la movio
    // entre la lectura y este UPDATE, devuelve `undefined` y no se pisa nada.
    const actualizada = await orderRepo.transitionStatus(
      order.id,
      order.status,
      to,
      opciones.timestamps,
      tx,
    );
    if (actualizada === undefined) throw errors.orderInvalidTransition(opciones.accion);

    await orderRepo.appendStatusHistory(
      {
        orderId: order.id,
        fromStatus: order.status,
        toStatus: to,
        actorType: toHistoryActorType(actor.type),
        actorId: actor.userId,
        note: opciones.note,
      },
      tx,
    );

    if (opciones.extra !== undefined) await opciones.extra(tx, actualizada);

    return actualizada;
  };

  const actualizada =
    opciones.db === undefined
      ? await getDatabase().transaction(ejecutar)
      : await ejecutar(opciones.db);

  // Solo se anuncia si la transaccion es nuestra: con un `db` ajeno no se
  // sabe cuando commitea (ver `order-events.ts`). Quien la pasa, emite.
  if (opciones.db === undefined) {
    await emitOrderTransition({
      orderId: order.id,
      orderNumber: order.orderNumber,
      buyerId: order.buyerId,
      sellerId: order.sellerId,
      from: order.status,
      to,
      actor: actor.type,
      actorUserId: actor.userId ?? null,
      occurredAt: new Date(),
      note: opciones.note,
    });
  }

  return actualizada;
}

/** Lo que el vendedor declara al despachar (SH-010, despacho manual). */
export interface MarkShippedInput {
  /** Codigo del transportista, de `shipping_carriers`. OBLIGATORIO. */
  carrier: string;
  /** Numero de seguimiento tal como lo dio el transportista. OBLIGATORIO. */
  trackingNumber: string;
}

/**
 * `PROCESSING → SHIPPED`: el vendedor dueño despacho y declara con quien y
 * con que numero. Crea el `shipment` (`provider = 'manual'`) en la misma
 * transaccion: no hay orden despachada sin envio ni envio sin orden.
 *
 * Transportista y numero son OBLIGATORIOS: sin ellos el comprador no tiene
 * como saber donde esta su paquete, y una disputa de "no recibido" no tiene
 * evidencia (SH-002).
 */
export async function markShipped(
  user: PublicUser,
  orderId: string,
  input: MarkShippedInput,
): Promise<PublicOrder> {
  const seller = await requireOwnSellerProfile(user);
  const order = await orderRepo.findById(orderId);
  if (order?.sellerId !== seller.id) throw errors.orderNotFound();

  // Se validan ANTES de abrir la transaccion: un transportista desconocido o
  // un numero vacio no tienen que costar un UPDATE que se revierte.
  const carrier = await requireCarrier(input.carrier);
  const trackingNumber = manualShipment.normalizeTrackingNumber(input.trackingNumber);
  const ahora = new Date();

  const actualizada = await transicionar(
    order,
    'SHIPPED',
    { type: 'seller', userId: user.id },
    {
      accion: 'despachar',
      note: `Despachado por ${carrier.name}, seguimiento ${trackingNumber}`,
      timestamps: { shippedAt: ahora },
      extra: (tx) =>
        manualShipment
          .registerManualDispatch(
            {
              orderId: order.id,
              carrier,
              trackingNumber,
              destination: order.shippingAddress,
              currency: order.currency,
              dispatchedAt: ahora,
            },
            tx,
          )
          .then(() => undefined),
    },
  );

  return toPublicOrder(actualizada);
}

/**
 * `SHIPPED → DELIVERED`: el comprador confirma que recibio el paquete.
 *
 * ⚠️ ASUMIDO: `marketplace-flow.md` §6 deriva `DELIVERED` del tracking de
 * Correo Argentino, que no existe. Sin proveedor, la unica persona que sabe
 * que el paquete llego es quien lo recibio. NO cierra la orden: desde aca
 * corre la ventana de proteccion (BR-033) y el cierre lo hace el sistema.
 */
export async function confirmDelivered(user: PublicUser, orderId: string): Promise<PublicOrder> {
  const order = await orderRepo.findById(orderId);
  if (order?.buyerId !== user.id) throw errors.orderNotFound();

  const ahora = new Date();

  const actualizada = await transicionar(
    order,
    'DELIVERED',
    { type: 'buyer', userId: user.id },
    {
      accion: 'marcar como recibida',
      note: 'El comprador confirmó que recibió el paquete',
      timestamps: { deliveredAt: ahora },
      extra: (tx) =>
        manualShipment.markShipmentDelivered(order.id, ahora, tx).then(() => undefined),
    },
  );

  return toPublicOrder(actualizada);
}

/**
 * `DELIVERED → COMPLETED`: la orden se cierra y la venta "existe" para la
 * reputacion, los tiers y los niveles (BR-051: solo cuentan las COMPLETED).
 *
 * Emite en `user_history_events` (DEC-036, fuente de verdad de la confianza)
 * `SALE_COMPLETED` para el vendedor y `PURCHASE_COMPLETED` para el comprador,
 * con `{ orderId }`. Los dos valores existen en el enum `history_event_type`.
 *
 * Devuelve `false` si la orden ya no estaba en `DELIVERED` (dos barridos
 * superpuestos): no es un error. Con `db` corre en esa transaccion y NO
 * anuncia el evento (quien la pasa, emite).
 */
export async function completeOrder(
  orderId: string,
  actor: OrderActor = SYSTEM_ACTOR,
  db?: Database,
): Promise<boolean> {
  const order = await orderRepo.findById(orderId, db);
  if (order === undefined) throw errors.orderNotFound();
  if (order.status !== 'DELIVERED') return false;

  const sellerUserId = await orderRepo.findSellerUserId(order.sellerId, db);
  if (sellerUserId === undefined)
    throw new Error(`La orden ${order.orderNumber} no tiene vendedor`);

  await transicionar(order, 'COMPLETED', actor, {
    accion: 'completar',
    note: 'Ventana de protección vencida sin reclamo. Orden completada',
    timestamps: { completedAt: new Date() },
    db,
    extra: async (tx) => {
      await orderRepo.appendUserHistoryEvent(
        {
          userId: sellerUserId,
          eventType: 'SALE_COMPLETED',
          role: 'seller',
          orderId: order.id,
          data: { orderId: order.id },
        },
        tx,
      );
      await orderRepo.appendUserHistoryEvent(
        {
          userId: order.buyerId,
          eventType: 'PURCHASE_COMPLETED',
          role: 'buyer',
          orderId: order.id,
          data: { orderId: order.id },
        },
        tx,
      );
    },
  });

  return true;
}

export type CompleteOutcome = 'completed' | 'not_delivered' | 'window_open' | 'dispute_open';

/**
 * Cierra la orden SOLO si esta `DELIVERED`, la proteccion al comprador vencio
 * y no hay reclamo abierto (BR-033 / MF-040). Para el barrido periodico;
 * idempotente: una orden ya cerrada devuelve `not_delivered`.
 */
export async function completeIfWindowElapsed(
  orderId: string,
  now: Date = new Date(),
): Promise<CompleteOutcome> {
  const order = await orderRepo.findById(orderId);
  if (order?.status !== 'DELIVERED') return 'not_delivered';

  const dias = await orderSettings.getBuyerProtectionDays();
  if (!hasProtectionWindowElapsed(order.deliveredAt, dias, now)) return 'window_open';

  // Se consulta JUSTO antes de cerrar, no al elegir candidatas: una disputa
  // abierta entre la lista y el UPDATE tiene que frenar el cierre.
  if (await orderRepo.hasOpenDispute(orderId)) return 'dispute_open';

  return (await completeOrder(orderId, SYSTEM_ACTOR)) ? 'completed' : 'not_delivered';
}

/* -------------------------------------------------------------------------- */
/* Cancelaciones                                                               */
/* -------------------------------------------------------------------------- */

/**
 * `PENDING_PAYMENT → CANCELLED` por el comprador (DEC-033 b).
 *
 * NO toca stock: nunca se desconto (MF-022). Deja el hecho `ORDER_CANCELLED`
 * en el historial del comprador con `cancelledBy: 'buyer'` para que la
 * reputacion pueda distinguirlo del vencimiento y de una cancelacion del
 * vendedor.
 *
 * ⚠️ Si hay un pago en curso en Mercado Pago (ticket de efectivo), el dinero
 * puede acreditarse sobre una orden cancelada: `markAsPaid` no la mueve
 * (exige `PENDING_PAYMENT`) y el caso queda para el refund del back-office.
 * ASUMIDO: la doc no lo contempla; se deja pasar y no se bloquea al comprador.
 */
export async function cancelPendingByBuyer(
  user: PublicUser,
  orderId: string,
): Promise<PublicOrder> {
  const order = await orderRepo.findById(orderId);
  if (order?.buyerId !== user.id) throw errors.orderNotFound();

  const actualizada = await transicionar(
    order,
    'CANCELLED',
    { type: 'buyer', userId: user.id },
    {
      accion: 'cancelar',
      note: 'Cancelada por el comprador antes de pagar',
      timestamps: { cancelledAt: new Date() },
      extra: (tx) =>
        orderRepo.appendUserHistoryEvent(
          {
            userId: user.id,
            eventType: 'ORDER_CANCELLED',
            role: 'buyer',
            orderId: order.id,
            data: { orderId: order.id, cancelledBy: 'buyer', fromStatus: order.status },
          },
          tx,
        ),
    },
  );

  return toPublicOrder(actualizada);
}

const MOTIVO_MIN = 5;
const MOTIVO_MAX = 500;

/**
 * `PROCESSING → CANCELLED` por el vendedor, ANTES de despachar.
 *
 * ⚠️ ASUMIDO: la politica de cancelacion sigue 🔴 (`orders-and-refunds.md`
 * §12). Esta transicion existe para que el vendedor que no puede cumplir lo
 * diga en vez de dejar vencer el plazo. Lo que hace, y por que:
 *
 *  - **Repone el stock** que se desconto al aprobarse el pago, en la misma
 *    transaccion; si la publicacion habia quedado `sold_out` por esa venta,
 *    vuelve a `active`.
 *  - **NO ejecuta el refund**: lo hace un administrador desde `payments`
 *    (consola de reembolsos). Queda en `audit_log` con `refundRequired: true`
 *    y los ids de los pagos para que no haya que buscarlos.
 *  - **Emite `ORDER_CANCELLED` con rol `seller`** en `user_history_events`,
 *    porque cancelar despues de cobrar cuenta para la reputacion (BR-032
 *    en espiritu: incumplir afecta reputacion).
 */
export async function cancelBySeller(
  user: PublicUser,
  orderId: string,
  motivo: string,
): Promise<PublicOrder> {
  const razon = motivo.trim();
  if (razon.length < MOTIVO_MIN || razon.length > MOTIVO_MAX) throw errors.cancelReasonRequired();

  const seller = await requireOwnSellerProfile(user);
  const order = await orderRepo.findById(orderId);
  if (order?.sellerId !== seller.id) throw errors.orderNotFound();

  const actualizada = await transicionar(
    order,
    'CANCELLED',
    { type: 'seller', userId: user.id },
    {
      accion: 'cancelar',
      note: `Cancelada por el vendedor antes de despachar: ${razon}`,
      timestamps: { cancelledAt: new Date() },
      extra: async (tx) => {
        const repuesto = await orderRepo.restoreStockForOrder(order.id, tx);
        const pagos = await orderRepo.findPaymentRefs(order.id, tx);

        await audit.record(
          {
            actorType: 'seller',
            actorId: user.id,
            action: 'ORDER_CANCELLED_BY_SELLER',
            entityType: 'order',
            entityId: order.id,
            before: { status: order.status },
            after: { status: 'CANCELLED' },
            metadata: {
              orderNumber: order.orderNumber,
              reason: razon,
              refundRequired: true,
              totalAmount: order.totalAmount.toString(),
              currency: order.currency,
              payments: pagos,
              restoredStock: repuesto,
            },
          },
          tx,
        );

        await orderRepo.appendUserHistoryEvent(
          {
            userId: user.id,
            eventType: 'ORDER_CANCELLED',
            role: 'seller',
            orderId: order.id,
            data: {
              orderId: order.id,
              cancelledBy: 'seller',
              fromStatus: order.status,
              reason: razon,
              refundRequired: true,
            },
          },
          tx,
        );
      },
    },
  );

  return toPublicOrder(actualizada);
}

/**
 * `PENDING_PAYMENT → CANCELLED` por vencimiento de la ventana de pago
 * (DEC-033 a). Para el barrido de `order-jobs.service.ts`.
 *
 * NO emite `ORDER_CANCELLED` en el historial de nadie: una orden que nadie
 * pago no es un hecho de conducta del comprador ni del vendedor. Devuelve
 * `false` si ya no estaba en `PENDING_PAYMENT`.
 */
export async function expirePendingOrder(
  orderId: string,
  now: Date = new Date(),
): Promise<boolean> {
  const order = await orderRepo.findById(orderId);
  if (order?.status !== 'PENDING_PAYMENT') return false;

  try {
    await transicionar(order, 'CANCELLED', SYSTEM_ACTOR, {
      accion: 'cancelar',
      note: 'Venció la ventana de pago sin que se aprobara el pago',
      timestamps: { cancelledAt: now },
    });
  } catch (error) {
    // Otro proceso la movio entre la lectura y el UPDATE: no es un error del
    // barrido, es exactamente lo que el WHERE condicional protege.
    if (error instanceof Error && 'code' in error && error.code === 'ORDER_NOT_PAYABLE') {
      return false;
    }
    throw error;
  }

  return true;
}
