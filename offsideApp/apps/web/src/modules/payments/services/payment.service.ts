import { randomUUID } from 'node:crypto';

import { getEnv } from '@offside/config';

import * as audit from '../../audit/services/audit.service';
import type { PublicUser } from '../../auth/services/auth.service';
import * as orderService from '../../orders/services/order.service';
import * as errors from '../payments.errors';
import * as mp from '../infrastructure/mercadopago/mercadopago-payments.client';
import * as paymentRepo from '../repositories/payment.repository';

/**
 * Checkout: inicia el cobro de una orden con Checkout Pro + Split 1:1.
 *
 * Implementa `docs-implementation/mercadopago-payments-spec.md` §6 y §7. Esta es
 * la capa de DOMINIO: decide, pero no sabe HTTP ni hablar con Mercado Pago.
 *
 * ⚠️ FRONTERA DE SECRETOS: este archivo nunca ve un `access_token`. La llamada a
 * Mercado Pago pasa por `infrastructure/`, que a su vez delega en
 * `sellers.requestAsSeller` (MP-PAY-001).
 *
 * ⚠️ COMISION: se **lee** de `orders.commission_amount`, que es el 6% ya
 * snapshoteado al crear la orden (DEC-043, DEC-030). No se calcula, no se
 * ajusta y **no se le resta el costo de Mercado Pago**: ese costo es
 * independiente y lo descuenta MP del lado del vendedor.
 */

const ENTITY_TYPE = 'payment';

export interface CheckoutResult {
  paymentId: string;
  /** URL a la que navega el frontend. El backend no redirige. */
  initPoint: string;
  /** Comision de Offside enviada como `marketplace_fee`, en centavos. */
  marketplaceFeeAmount: string;
}

/** URLs de retorno del checkout. Provisorias hasta que exista el frontend. */
function backUrls(orderId: string): { success: string; pending: string; failure: string } {
  const base = getEnv().APP_URL;
  const url = (estado: string) => `${base}/checkout/${orderId}?status=${estado}`;

  return { success: url('success'), pending: url('pending'), failure: url('failure') };
}

function notificationUrl(): string {
  return `${getEnv().APP_URL}/api/webhooks/mercadopago/payments`;
}

/**
 * Inicia el pago de una orden.
 *
 * Orden de las verificaciones (spec §6): sesion → propiedad de la orden →
 * estado → vencimiento → conexion del vendedor. Lo mas barato y lo mas
 * restrictivo primero.
 */
export async function startCheckout(user: PublicUser, orderId: string): Promise<CheckoutResult> {
  const encontrada = await orderService.getOrderForPayment(orderId);
  if (encontrada === null) throw errors.orderNotFound();

  const { order, items } = encontrada;

  // AUTORIZACION: la orden tiene que ser del comprador autenticado. Se compara
  // contra `user.id`, nunca contra un id que venga del request.
  // ⚠️ Mismo error que "no existe": distinguirlos permitiria enumerar ordenes.
  if (order.buyerId !== user.id) throw errors.orderNotFound();

  if (order.status !== 'PENDING_PAYMENT') throw errors.orderNotPayable();

  if (order.paymentDeadline !== null && order.paymentDeadline.getTime() <= Date.now()) {
    throw errors.paymentDeadlineExpired();
  }

  // El snapshot manda. Si no esta, es un bug de datos: no se recalcula (DEC-030).
  if (order.commissionAmount === null) throw errors.orderWithoutCommissionSnapshot();

  // Reutilizar el intento vivo hace idempotente al doble clic del comprador:
  // dos POST seguidos devuelven la MISMA preferencia, no dos.
  const reusable = await paymentRepo.findReusablePending(order.id);
  if (reusable?.mpPreferenceId != null) {
    const previo = (reusable.raw as { init_point?: unknown } | null)?.init_point;
    if (typeof previo === 'string' && previo !== '') {
      return {
        paymentId: reusable.id,
        initPoint: previo,
        marketplaceFeeAmount: order.commissionAmount.toString(),
      };
    }
  }

  // La fila local se crea ANTES de llamar a MP (MP-PAY-004).
  const payment =
    reusable ??
    (await paymentRepo.insertPending({
      orderId: order.id,
      amount: order.totalAmount,
      currency: order.currency,
      idempotencyKey: randomUUID(),
    }));

  let preferencia;
  try {
    preferencia = await mp.createPreference({
      sellerId: order.sellerId,
      orderId: order.id,
      items: items.map((item) => ({
        id: item.id,
        title: item.titleSnapshot,
        quantity: item.quantity,
        unitPriceCents: item.unitPriceAmount,
        currency: item.currency,
      })),
      marketplaceFeeCents: order.commissionAmount,
      notificationUrl: notificationUrl(),
      backUrls: backUrls(order.id),
      expiresAt: order.paymentDeadline,
      idempotencyKey: payment.idempotencyKey ?? payment.id,
    });
  } catch (error) {
    const detalle =
      error instanceof mp.MercadoPagoPaymentError
        ? {
            failure: error.failure,
            ...(error.httpStatus === undefined ? {} : { httpStatus: error.httpStatus }),
          }
        : {};

    await audit.record({
      actorType: 'user',
      actorId: user.id,
      action: 'PAYMENT_PREFERENCE_FAILED',
      entityType: ENTITY_TYPE,
      entityId: payment.id,
      metadata: { orderId: order.id, ...detalle },
    });

    throw errors.paymentProviderError();
  }

  await paymentRepo.attachPreference(payment.id, preferencia.preferenceId);

  await audit.record({
    actorType: 'user',
    actorId: user.id,
    action: 'PAYMENT_PREFERENCE_CREATED',
    entityType: ENTITY_TYPE,
    entityId: payment.id,
    metadata: {
      orderId: order.id,
      preferenceId: preferencia.preferenceId,
      amount: order.totalAmount.toString(),
      marketplaceFee: order.commissionAmount.toString(),
      collectorId: preferencia.collectorId,
    },
  });

  return {
    paymentId: payment.id,
    initPoint: preferencia.initPoint,
    marketplaceFeeAmount: order.commissionAmount.toString(),
  };
}

/** Vista publica de un pago. NUNCA incluye credenciales ni el payload crudo. */
export interface PublicPayment {
  id: string;
  orderId: string;
  status: paymentRepo.PaymentStatus;
  mpStatus: string | null;
  amount: string;
  currency: string;
  approvedAt: string | null;
}

export function toPublicPayment(row: paymentRepo.PaymentRow): PublicPayment {
  return {
    id: row.id,
    orderId: row.orderId,
    status: row.status,
    mpStatus: row.mpStatus,
    amount: row.amount.toString(),
    currency: row.currency,
    approvedAt: row.approvedAt?.toISOString() ?? null,
  };
}
