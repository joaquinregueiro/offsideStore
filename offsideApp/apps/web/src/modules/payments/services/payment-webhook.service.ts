import { getDatabase } from '@offside/database';

import * as audit from '../../audit/services/audit.service';
import * as orderService from '../../orders/services/order.service';
import { resolveSellerIdByMpUserId } from '../../sellers/services/mercadopago-connection.service';
import * as mp from '../infrastructure/mercadopago/mercadopago-payments.client';
import {
  isTerminal,
  mapMercadoPagoStatus,
} from '../infrastructure/mercadopago/payment-status.mapper';
import * as paymentRepo from '../repositories/payment.repository';
import * as webhookRepo from '../repositories/payment-webhook.repository';

/**
 * Procesamiento de los webhooks de pago de Mercado Pago.
 *
 * Implementa la spec §11. Reglas que gobiernan todo este archivo:
 *
 *  - **El webhook es la fuente de verdad del pago, no el redirect** (PC-040).
 *  - **Nunca se confia en el payload**: trae un id y se RECONSULTA el pago a la
 *    API de MP (PC-041 / MP-PAY-006).
 *  - **Idempotente**: MP reintenta cada 15 minutos y los eventos llegan
 *    desordenados. Procesar dos veces no puede cambiar el resultado.
 *  - El efecto se decide por el estado CONSULTADO, no por el orden de llegada
 *    (PC-043).
 */

const PROVIDER = 'mercadopago';
const ENTITY_TYPE = 'payment';

/** Cuerpo de la notificacion, en los campos que Offside usa. */
export interface WebhookNotification {
  /** `type` o `topic` segun la variante. Ej. `payment`. */
  type: string | null;
  /** `action`. Ej. `payment.created`. */
  action: string | null;
  /** `data.id`: el id del recurso en Mercado Pago. */
  dataId: string | null;
  /** `id` de la notificacion. Parte de la clave de idempotencia. */
  notificationId: string | null;
  /**
   * `user_id`: la cuenta de Mercado Pago que recibio el pago.
   *
   * Es lo que permite saber CON QUE credenciales reconsultar el pago, porque
   * Mercado Pago exige el token del vendedor para leer su propio pago.
   */
  mpUserId: string | null;
}

export type WebhookOutcome =
  'processed' | 'duplicate' | 'ignored' | 'unknown_payment' | 'provider_error';

/**
 * Clave de idempotencia del evento.
 *
 * Combina el id de la notificacion, el recurso y la accion: MP puede mandar
 * varias notificaciones distintas sobre el MISMO pago (created, updated), y
 * esas no son duplicados.
 */
export function buildEventKey(notification: WebhookNotification): string {
  const partes = [
    PROVIDER,
    notification.notificationId ?? 'sin-id',
    notification.action ?? notification.type ?? 'sin-accion',
    notification.dataId ?? 'sin-recurso',
  ];

  return partes.join(':');
}

/**
 * Registra el evento y lo procesa.
 *
 * La firma ya fue validada por el controller: acá se asume autentico. El
 * registro ocurre SIEMPRE y primero, porque la traza del evento importa aunque
 * el procesamiento falle.
 */
export async function handleNotification(
  notification: WebhookNotification,
  payload: unknown,
): Promise<WebhookOutcome> {
  const evento = await webhookRepo.recordIfNew({
    provider: PROVIDER,
    eventType: notification.action ?? notification.type ?? 'desconocido',
    resourceId: notification.dataId,
    idempotencyKey: buildEventKey(notification),
    signatureValid: true,
    payload,
  });

  // `null` = el UNIQUE lo rechazo: ya se proceso. No se vuelve a aplicar.
  if (evento === null) return 'duplicate';

  // Offside sólo actua sobre el topic `payment` (Checkout Pro). El resto se
  // registra y se ignora: no se inventa comportamiento para topics no
  // implementados (merchant_order, chargebacks, claims).
  const esPago = (notification.type ?? '').toLowerCase() === 'payment';
  if (!esPago || notification.dataId === null) {
    await webhookRepo.markProcessed(evento.id, {});
    return 'ignored';
  }

  try {
    const resultado = await syncPaymentFromMercadoPago(notification.dataId, notification.mpUserId);
    await webhookRepo.markProcessed(evento.id, {});
    return resultado;
  } catch (error) {
    const motivo =
      error instanceof mp.MercadoPagoPaymentError ? error.failure : 'error_no_controlado';

    // ⚠️ Se guarda la CATEGORIA, nunca el error completo ni el payload de MP.
    await webhookRepo.markProcessed(evento.id, { error: motivo });

    if (!(error instanceof mp.MercadoPagoPaymentError)) {
      console.error('[payments] error no controlado procesando un webhook:', error);
    }

    return 'provider_error';
  }
}

/**
 * Reconsulta el pago a Mercado Pago y sincroniza el estado local.
 *
 * Es idempotente por construccion: aplica el estado que MP informa AHORA, no un
 * delta. Correrlo dos veces deja el mismo resultado.
 */
export async function syncPaymentFromMercadoPago(
  mpPaymentId: string,
  mpUserId: string | null,
): Promise<WebhookOutcome> {
  // El pago local se ubica por `mp_payment_id` cuando el evento ya se proceso
  // antes; la primera vez todavia no hay vinculo.
  const yaVinculado = await paymentRepo.findByMpPaymentId(mpPaymentId);

  const sellerId = await resolveSellerId(yaVinculado, mpUserId);
  if (sellerId === null) return 'unknown_payment';

  const pago = await mp.fetchPayment(sellerId, mpPaymentId);

  // `external_reference` es el `orders.id` que Offside envio al crear la
  // preferencia (MP-PAY-003). Sin el no se puede atribuir el pago a una orden.
  const orderId = yaVinculado?.orderId ?? pago.externalReference;
  if (orderId === null) return 'unknown_payment';

  const local = yaVinculado ?? (await findLocalPaymentForOrder(orderId));
  if (local === undefined) return 'unknown_payment';

  // Un pago no puede reasignarse a otra orden: si el `external_reference` no
  // coincide con la orden del pago local, algo esta mal y no se toca nada.
  if (local.orderId !== orderId) {
    console.error('[payments] el pago de Mercado Pago no corresponde a la orden local');
    return 'unknown_payment';
  }

  const mapeado = mapMercadoPagoStatus(pago.mpStatus, pago.mpStatusDetail);

  if (mapeado.status === null) {
    // Estado que Offside no modela (`in_mediation`) o desconocido: se conserva
    // el crudo y NO se toca el estado local. Adivinar seria peor.
    if (mapeado.unknown) {
      console.warn(`[payments] estado de Mercado Pago no reconocido: ${pago.mpStatus}`);
    }

    await audit.record({
      actorType: 'system',
      action: 'PAYMENT_STATUS_UNMAPPED',
      entityType: ENTITY_TYPE,
      entityId: local.id,
      metadata: { mpStatus: pago.mpStatus, unknown: mapeado.unknown },
    });

    return 'processed';
  }

  const objetivo = mapeado.status;

  // Un pago ya terminal no vuelve atras por un webhook viejo que llegue tarde.
  if (isTerminal(local.status) && local.status !== objetivo) {
    await audit.record({
      actorType: 'system',
      action: 'PAYMENT_STATUS_IGNORED',
      entityType: ENTITY_TYPE,
      entityId: local.id,
      metadata: { current: local.status, incoming: objetivo },
    });

    return 'processed';
  }

  const antes = local.status;

  await getDatabase().transaction(async (tx) => {
    await paymentRepo.applyMercadoPagoState(
      local.id,
      {
        status: objetivo,
        mpPaymentId: pago.mpPaymentId,
        mpStatus: pago.mpStatus,
        mpStatusDetail: pago.mpStatusDetail,
        paymentMethod: pago.paymentMethod,
        installments: pago.installments,
        approvedAt: pago.approvedAt,
        raw: pago.raw,
      },
      tx,
    );

    if (objetivo === 'APPROVED') {
      await aplicarAprobacion(local, pago, orderId, tx);
    }

    if (antes !== objetivo) {
      await audit.record(
        {
          actorType: 'system',
          action: 'PAYMENT_STATUS_CHANGED',
          entityType: ENTITY_TYPE,
          entityId: local.id,
          before: { status: antes },
          after: { status: objetivo },
          metadata: { origin: 'webhook', mpStatus: pago.mpStatus },
        },
        tx,
      );
    }
  });

  return 'processed';
}

/**
 * Con que vendedor se consulta el pago.
 *
 * Prioridad: el vendedor de la orden ya vinculada; si no hay vinculo, el
 * `user_id` de la notificacion resuelto contra `mercadopago_accounts`.
 *
 * ⚠️ No se inventa un tercer camino: sin ninguno de los dos, el pago no es
 * atribuible y el evento queda registrado sin efecto.
 */
async function resolveSellerId(
  yaVinculado: paymentRepo.PaymentRow | undefined,
  mpUserId: string | null,
): Promise<string | null> {
  if (yaVinculado !== undefined) {
    const order = await orderService.findById(yaVinculado.orderId);
    if (order !== undefined) return order.sellerId;
  }

  if (mpUserId !== null && mpUserId !== '') {
    return resolveSellerIdByMpUserId(mpUserId);
  }

  return null;
}

/** Efectos de un pago aprobado: orden a `PAID` y reparto registrado. */
async function aplicarAprobacion(
  local: paymentRepo.PaymentRow,
  pago: mp.FetchedPayment,
  orderId: string,
  tx: Parameters<Parameters<ReturnType<typeof getDatabase>['transaction']>[0]>[0],
): Promise<void> {
  const transicionó = await orderService.markAsPaid(orderId, pago.approvedAt ?? new Date(), tx);

  // Sin transicion, la orden ya estaba pagada: webhook duplicado. No se
  // registra el split dos veces.
  if (!transicionó) return;

  const order = await orderService.findById(orderId);

  if (order?.commissionAmount != null && pago.amountCents !== null) {
    const mpFee =
      pago.netReceivedAmountCents === null
        ? null
        : pago.amountCents - pago.netReceivedAmountCents - order.commissionAmount;

    await paymentRepo.insertSplit(
      {
        paymentId: local.id,
        // Lo que le queda al vendedor segun lo que MP informo. Si MP no informa
        // el neto, se registra el esperado por el snapshot comercial.
        sellerAmount: pago.netReceivedAmountCents ?? order.sellerAmount ?? 0n,
        marketplaceFeeAmount: order.commissionAmount,
        mpFeeAmount: mpFee !== null && mpFee >= 0n ? mpFee : null,
        currency: pago.currency ?? local.currency,
        raw: pago.raw,
      },
      tx,
    );
  }

  await audit.record(
    {
      actorType: 'system',
      action: 'PAYMENT_APPROVED',
      entityType: ENTITY_TYPE,
      entityId: local.id,
      metadata: {
        orderId,
        mpPaymentId: pago.mpPaymentId,
        amount: pago.amountCents?.toString() ?? null,
        mpStatus: pago.mpStatus,
      },
    },
    tx,
  );
}

/** Pago local de una orden que puede recibir el estado de Mercado Pago. */
async function findLocalPaymentForOrder(
  orderId: string,
): Promise<paymentRepo.PaymentRow | undefined> {
  const pagos = await paymentRepo.findByOrderId(orderId);

  return pagos.find((p) => p.status === 'PENDING' || p.status === 'IN_PROCESS') ?? pagos[0];
}
