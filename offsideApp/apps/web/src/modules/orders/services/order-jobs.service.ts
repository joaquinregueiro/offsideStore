import { getRedisClient, withLock, type LockStore } from '@offside/jobs';

import * as audit from '../../audit/services/audit.service';
import * as orderRepo from '../repositories/order.repository';
import * as orderSettings from './order-settings.service';
import { completeIfWindowElapsed, expirePendingOrder } from './order.service';

/**
 * Barridos periodicos del ciclo de la orden (DEC-029), programados desde
 * `instrumentation.ts` con `upsertJobScheduler`, igual que el refresh de
 * tokens de Mercado Pago.
 *
 *  - `expirePendingPayments`: cancela las `PENDING_PAYMENT` con la ventana de
 *    pago vencida (DEC-033 a), salvo las que tienen un pago en curso en
 *    Mercado Pago, que se auditan y se dejan.
 *  - `completeDeliveredOrders`: cierra las `DELIVERED` cuya proteccion al
 *    comprador vencio sin reclamo (BR-033 / MF-040).
 *
 * ⚠️ LOS DOS SON IDEMPOTENTES POR CONSTRUCCION: cada transicion condiciona el
 * UPDATE al estado de origen, asi que correrlos dos veces —o a la vez desde
 * dos instancias— no repite nada. El lock en Redis evita ademas que dos
 * instancias hagan el mismo trabajo en paralelo; si no se consigue, el barrido
 * se saltea y el proximo lo cubre.
 *
 * ⚠️ NO SE DETIENEN ANTE UN FALLO: una orden con un problema no puede impedir
 * que se procesen las demas. Se cuenta y se sigue, como `refreshExpiring`.
 */

/** Prefijo propio: Redis es compartido y otros modulos tienen sus locks. */
const LOCK_PREFIX = 'orders:jobs:lock:';
/** Mas largo que lo que tarda una tanda; se libera en `finally` de todos modos. */
const LOCK_TTL_SECONDS = 5 * 60;
/** Tamaño de tanda: el barrido corre seguido y no necesita vaciar la cola de una. */
const LOTE = 200;

/**
 * Marca "ya auditada" para no escribir el mismo aviso en cada corrida: el
 * barrido corre cada pocos minutos y un ticket de Rapipago tarda un dia. Un
 * dia de TTL = un aviso por dia por orden mientras siga en esa situacion.
 */
const AUDITADA_PREFIX = 'orders:jobs:expiry-deferred:';
const AUDITADA_TTL_SECONDS = 24 * 60 * 60;

export interface ExpirySummary {
  /** El lock estaba tomado: no se hizo nada. */
  skipped: boolean;
  evaluadas: number;
  canceladas: number;
  /** Vencidas pero con pago en curso en Mercado Pago: quedan y se auditan. */
  diferidas: number;
  fallidas: number;
}

export async function expirePendingPayments(
  now: Date = new Date(),
  store: LockStore = getRedisClient(),
): Promise<ExpirySummary> {
  const resultado = await withLock(
    `${LOCK_PREFIX}expire-pending-payment`,
    LOCK_TTL_SECONDS,
    async () => {
      const resumen = { evaluadas: 0, canceladas: 0, diferidas: 0, fallidas: 0 };

      const vencidas = await orderRepo.findExpiredPendingPayment(now, LOTE);
      resumen.evaluadas = vencidas.length;

      for (const orden of vencidas) {
        try {
          if (await expirePendingOrder(orden.id, now)) resumen.canceladas += 1;
        } catch (error) {
          resumen.fallidas += 1;
          console.error(
            `[orders] no se pudo vencer la orden ${orden.orderNumber}:`,
            error instanceof Error ? error.message : String(error),
          );
        }
      }

      const diferidas = await orderRepo.findExpiredPendingWithPaymentInProgress(now, LOTE);
      resumen.diferidas = diferidas.length;

      for (const orden of diferidas) {
        try {
          await auditarDiferida(orden, now, store);
        } catch (error) {
          resumen.fallidas += 1;
          console.error(
            `[orders] no se pudo auditar la orden diferida ${orden.orderNumber}:`,
            error instanceof Error ? error.message : String(error),
          );
        }
      }

      return resumen;
    },
    store,
  );

  if (!resultado.acquired) {
    return { skipped: true, evaluadas: 0, canceladas: 0, diferidas: 0, fallidas: 0 };
  }

  const resumen = { skipped: false, ...resultado.result };
  if (resumen.evaluadas > 0 || resumen.diferidas > 0) {
    console.warn(
      `[orders] vencimiento de pago: ${resumen.evaluadas} vencidas, ${resumen.canceladas} ` +
        `canceladas, ${resumen.diferidas} diferidas por pago en curso, ${resumen.fallidas} fallidas`,
    );
  }

  return resumen;
}

/**
 * Deja constancia de que una orden vencida NO se cancelo porque Mercado Pago
 * tiene un pago en curso. Una vez por dia por orden (ver `AUDITADA_PREFIX`).
 */
async function auditarDiferida(
  orden: orderRepo.OrderRow,
  now: Date,
  store: LockStore,
): Promise<void> {
  const marca = await store.set(
    `${AUDITADA_PREFIX}${orden.id}`,
    '1',
    'EX',
    AUDITADA_TTL_SECONDS,
    'NX',
  );
  if (marca !== 'OK') return;

  const pagos = await orderRepo.findPaymentRefs(orden.id);

  await audit.record({
    actorType: 'system',
    action: 'ORDER_EXPIRY_DEFERRED_PAYMENT_IN_PROGRESS',
    entityType: 'order',
    entityId: orden.id,
    metadata: {
      orderNumber: orden.orderNumber,
      paymentDeadline: orden.paymentDeadline?.toISOString() ?? null,
      evaluatedAt: now.toISOString(),
      payments: pagos.filter((p) => p.status === 'PENDING' || p.status === 'IN_PROCESS'),
    },
  });
}

export interface CompletionSummary {
  skipped: boolean;
  evaluadas: number;
  completadas: number;
  /** Aparecio un reclamo entre la lista y el cierre. */
  conReclamo: number;
  fallidas: number;
}

export async function completeDeliveredOrders(
  now: Date = new Date(),
  store: LockStore = getRedisClient(),
): Promise<CompletionSummary> {
  const resultado = await withLock(
    `${LOCK_PREFIX}complete-delivered`,
    LOCK_TTL_SECONDS,
    async () => {
      const resumen = { evaluadas: 0, completadas: 0, conReclamo: 0, fallidas: 0 };

      // El corte se calcula UNA vez con la configuracion vigente: es un plazo
      // operativo, no un snapshot (ver `dispatchDeadlineFor`).
      const dias = await orderSettings.getBuyerProtectionDays();
      const corte = new Date(now.getTime() - dias * 24 * 60 * 60 * 1000);

      const listas = await orderRepo.findDeliveredReadyToComplete(corte, LOTE);
      resumen.evaluadas = listas.length;

      for (const orden of listas) {
        try {
          const outcome = await completeIfWindowElapsed(orden.id, now);
          if (outcome === 'completed') resumen.completadas += 1;
          if (outcome === 'dispute_open') resumen.conReclamo += 1;
        } catch (error) {
          resumen.fallidas += 1;
          console.error(
            `[orders] no se pudo completar la orden ${orden.orderNumber}:`,
            error instanceof Error ? error.message : String(error),
          );
        }
      }

      return resumen;
    },
    store,
  );

  if (!resultado.acquired) {
    return { skipped: true, evaluadas: 0, completadas: 0, conReclamo: 0, fallidas: 0 };
  }

  const resumen = { skipped: false, ...resultado.result };
  if (resumen.evaluadas > 0) {
    console.warn(
      `[orders] cierre por proteccion vencida: ${resumen.evaluadas} evaluadas, ` +
        `${resumen.completadas} completadas, ${resumen.conReclamo} con reclamo, ${resumen.fallidas} fallidas`,
    );
  }

  return resumen;
}
