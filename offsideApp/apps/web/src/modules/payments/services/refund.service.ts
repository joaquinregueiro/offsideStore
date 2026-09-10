import { getDatabase } from '@offside/database';

import * as audit from '../../audit/services/audit.service';
import type { PublicUser } from '../../auth/services/auth.service';
import * as orderService from '../../orders/services/order.service';
import * as mp from '../infrastructure/mercadopago/mercadopago-payments.client';
import * as errors from '../payments.errors';
import * as paymentRepo from '../repositories/payment.repository';
import * as refundRepo from '../repositories/refund.repository';

/**
 * Reembolsos (spec §12).
 *
 * ⚠️ ALCANCE: la MECANICA de devolver dinero, no la POLITICA de cuándo
 * corresponde. Quien decide si un reembolso procede —plazos, causales, si
 * Offside adelanta el dinero cuando no puede recuperar la parte del vendedor—
 * sigue 🟡 sin definir (`orders-and-refunds.md` §5.5). Por eso el endpoint es
 * **administrativo**: exponerlo al comprador o al vendedor implicaria inventar
 * esa politica.
 *
 * ⚠️ QUIEN DEVUELVE QUE: lo resuelve Mercado Pago. 🔴 _"o valor devido ao
 * cliente final sera dividido e subtraido da conta do vendedor e da conta do
 * Marketplace, sendo proporcional para as partes envolvidas"_. Offside **no**
 * calcula el reparto de la devolucion ni se lo transfiere al vendedor: MP le
 * descuenta a cada parte lo suyo. Coherente con DEC-018.
 */

const ENTITY_TYPE = 'payment';

export interface RefundInput {
  paymentId: string;
  /** `null` = reembolso TOTAL. Con importe (en centavos) = parcial. */
  amountCents: bigint | null;
  reason: string | null;
}

export interface PublicRefund {
  id: string;
  paymentId: string;
  type: refundRepo.RefundType;
  status: refundRepo.RefundStatus;
  amount: string;
  currency: string;
  mpRefundId: string | null;
}

function toPublicRefund(row: refundRepo.RefundRow): PublicRefund {
  return {
    id: row.id,
    paymentId: row.paymentId,
    type: row.type,
    status: row.status,
    amount: row.amount.toString(),
    currency: row.currency,
    mpRefundId: row.mpRefundId,
  };
}

/** Estados desde los que tiene sentido devolver dinero. */
const REEMBOLSABLES = new Set<paymentRepo.PaymentStatus>(['APPROVED', 'PARTIALLY_REFUNDED']);

/**
 * Suma de lo ya devuelto sobre un pago.
 *
 * Solo cuentan los reembolsos COMPLETADOS o en curso: un rechazado no consumio
 * saldo.
 */
function totalDevuelto(refunds: refundRepo.RefundRow[]): bigint {
  return refunds.filter((r) => r.status !== 'REJECTED').reduce((suma, r) => suma + r.amount, 0n);
}

/**
 * Ejecuta un reembolso total o parcial.
 *
 * ⚠️ ADMINISTRATIVO: quien llama ya verifico el rol (el controller). Este
 * servicio no autoriza usuarios.
 */
export async function refundPayment(admin: PublicUser, input: RefundInput): Promise<PublicRefund> {
  const payment = await paymentRepo.findById(input.paymentId);
  if (payment === undefined) throw errors.paymentNotFound();

  if (!REEMBOLSABLES.has(payment.status)) throw errors.paymentNotRefundable();

  const order = await orderService.findById(payment.orderId);
  if (order === undefined) throw errors.orderNotFound();

  // Sin `mp_payment_id` no hay nada que devolver en Mercado Pago: el pago
  // nunca llego a concretarse.
  if (payment.mpPaymentId === null) throw errors.paymentNotRefundable();

  const previos = await refundRepo.findByPaymentId(payment.id);
  const yaDevuelto = totalDevuelto(previos);
  const disponible = payment.amount - yaDevuelto;

  if (disponible <= 0n) throw errors.paymentNotRefundable();

  if (input.amountCents !== null) {
    if (input.amountCents <= 0n) {
      throw errors.refundAmountInvalid('El importe a reembolsar debe ser mayor a cero');
    }

    // 🔴 MP admite varios parciales mientras la suma no supere el total.
    if (input.amountCents > disponible) {
      throw errors.refundAmountInvalid('El importe supera lo que queda por reembolsar');
    }
  }

  const importe = input.amountCents ?? disponible;
  const esTotal = importe === payment.amount && yaDevuelto === 0n;

  // La fila local se crea ANTES de llamar a MP: si la llamada se cae, queda
  // rastro de que se intento devolver dinero.
  const refund = await refundRepo.insertProcessing({
    orderId: payment.orderId,
    paymentId: payment.id,
    type: esTotal ? 'FULL' : 'PARTIAL',
    amount: importe,
    currency: payment.currency,
    reason: input.reason,
  });

  await audit.record({
    actorType: 'admin',
    actorId: admin.id,
    action: 'REFUND_REQUESTED',
    entityType: ENTITY_TYPE,
    entityId: payment.id,
    metadata: {
      refundId: refund.id,
      amount: importe.toString(),
      type: esTotal ? 'FULL' : 'PARTIAL',
      reason: input.reason,
    },
  });

  let resultado;
  try {
    resultado = await mp.createRefund({
      sellerId: order.sellerId,
      mpPaymentId: payment.mpPaymentId,
      // Total explicito: se manda sin `amount` solo si de verdad es el total.
      amountCents: esTotal ? null : importe,
      // Idempotencia derivada del refund local: un reintento no devuelve dos
      // veces (MP exige el header en esta API).
      idempotencyKey: refund.id,
    });
  } catch (error) {
    await refundRepo.markRejected(refund.id);

    const detalle =
      error instanceof mp.MercadoPagoPaymentError
        ? {
            failure: error.failure,
            ...(error.httpStatus === undefined ? {} : { httpStatus: error.httpStatus }),
          }
        : {};

    await audit.record({
      actorType: 'admin',
      actorId: admin.id,
      action: 'REFUND_FAILED',
      entityType: ENTITY_TYPE,
      entityId: payment.id,
      metadata: { refundId: refund.id, ...detalle },
    });

    throw errors.paymentProviderError();
  }

  const nuevoTotal = yaDevuelto + importe;
  const nuevoEstado: paymentRepo.PaymentStatus =
    nuevoTotal >= payment.amount ? 'REFUNDED' : 'PARTIALLY_REFUNDED';

  const completado = await getDatabase().transaction(async (tx) => {
    const fila = await refundRepo.markCompleted(
      refund.id,
      { mpRefundId: resultado.mpRefundId, raw: resultado.raw },
      tx,
    );

    await paymentRepo.updateStatus(payment.id, nuevoEstado, tx);

    await audit.record(
      {
        actorType: 'admin',
        actorId: admin.id,
        action: 'REFUND_COMPLETED',
        entityType: ENTITY_TYPE,
        entityId: payment.id,
        before: { status: payment.status },
        after: { status: nuevoEstado },
        metadata: {
          refundId: refund.id,
          amount: importe.toString(),
          mpRefundId: resultado.mpRefundId,
        },
      },
      tx,
    );

    return fila;
  });

  return toPublicRefund(completado ?? refund);
}

/** Reembolsos de un pago. */
export async function listRefunds(paymentId: string): Promise<PublicRefund[]> {
  const rows = await refundRepo.findByPaymentId(paymentId);
  return rows.map(toPublicRefund);
}

/** Un pago de la orden, tal como lo ve el back-office. */
export interface AdminPayment {
  id: string;
  status: paymentRepo.PaymentStatus;
  /** Estado crudo de Mercado Pago (DEC-035). Se muestra junto al mapeado. */
  mpStatus: string | null;
  mpPaymentId: string | null;
  amount: string;
  currency: string;
  /** Suma de los reembolsos que consumieron saldo. */
  refundedAmount: string;
  /** Lo que todavia se puede devolver. `'0'` si no queda nada. */
  refundableAmount: string;
  refunds: PublicRefund[];
  createdAt: string;
}

export interface AdminOrderPayments {
  order: orderService.PublicOrder;
  payments: AdminPayment[];
}

/**
 * Pagos de una orden, buscada por su numero visible. Consola de reembolsos.
 *
 * ⚠️ NO AUTORIZA. Devuelve datos de cualquier orden: quien llama tiene que
 * haber verificado `payments:refund` antes. Es lectura pura; no toca Mercado
 * Pago ni escribe nada.
 *
 * ⚠️ `refundableAmount` SE CALCULA CON LA MISMA REGLA QUE `refundPayment`
 * —importe menos lo ya devuelto, sin contar los rechazados—, para que la
 * pantalla no ofrezca un importe que el Service va a rechazar. Sigue siendo el
 * Service el que decide: esto es una vista, no una validacion.
 */
export async function findOrderPaymentsForAdmin(
  orderNumber: string,
): Promise<AdminOrderPayments | null> {
  const order = await orderService.findByOrderNumber(orderNumber);
  if (order === null) return null;

  const pagos = await paymentRepo.findByOrderId(order.id);

  const payments = await Promise.all(
    pagos.map(async (pago): Promise<AdminPayment> => {
      const refunds = await refundRepo.findByPaymentId(pago.id);
      const devuelto = totalDevuelto(refunds);
      const disponible = REEMBOLSABLES.has(pago.status) ? pago.amount - devuelto : 0n;

      return {
        id: pago.id,
        status: pago.status,
        mpStatus: pago.mpStatus,
        mpPaymentId: pago.mpPaymentId,
        amount: pago.amount.toString(),
        currency: pago.currency,
        refundedAmount: devuelto.toString(),
        refundableAmount: (disponible > 0n ? disponible : 0n).toString(),
        refunds: refunds.map(toPublicRefund),
        createdAt: pago.createdAt.toISOString(),
      };
    }),
  );

  return { order, payments };
}
