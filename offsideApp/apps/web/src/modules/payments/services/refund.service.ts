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
