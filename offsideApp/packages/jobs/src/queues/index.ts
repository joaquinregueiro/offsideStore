import { Queue, type JobsOptions, type QueueOptions } from 'bullmq';

import { getRedisClient } from '../connection';

/**
 * Registro de colas.
 *
 * La primera cola de negocio es `notifications-send`. El resto sigue previsto:
 *
 * La infraestructura esta lista; los jobs concretos se agregan cuando se
 * implemente su modulo. Colas previstas (architecture.md §8, tech-stack.md §2):
 *
 *   payments-webhooks     procesamiento idempotente de webhooks de Mercado Pago
 *   payments-reconcile    conciliacion periodica contra MP
 *   shipments-tracking    consulta/actualizacion de tracking de Correo Argentino
 *   notifications-send    envio de emails y avisos in-app
 *
 * Los nombres de arriba son PREVISIONES, no decisiones. Se confirman al
 * implementar cada modulo.
 *
 * ⚠️ RESTRICCION DE BULLMQ: el nombre de una cola NO puede contener `:`.
 * BullMQ lo usa como separador de sus propias claves en Redis y rechaza el
 * nombre en tiempo de construccion. Usar `-` como separador.
 */

/** Nombres de cola registrados. Se completa al agregar cada cola. */
export const QUEUE_NAMES = {
  /** Envio de emails y avisos in-app (notifications-and-engagement.md §2.2). */
  NOTIFICATIONS_SEND: 'notifications-send',
  /** Renovacion de los tokens de Mercado Pago (mercadopago-oauth-spec.md §10). */
  MERCADOPAGO_TOKEN_REFRESH: 'mercadopago-token-refresh',
  /**
   * Barrido que cancela las ordenes `PENDING_PAYMENT` con la ventana de pago
   * vencida (DEC-033). Periodico; el procesador vive en `modules/orders`.
   */
  ORDERS_EXPIRE_PENDING_PAYMENT: 'orders-expire-pending-payment',
  /**
   * Barrido que cierra las ordenes `DELIVERED` cuya ventana de proteccion
   * vencio sin reclamo (BR-033 / MF-040). Periodico; procesador en `orders`.
   */
  ORDERS_COMPLETE_DELIVERED: 'orders-complete-delivered',
  /**
   * Barrido que pasa a revision de Offside los reclamos cuyo plazo de
   * respuesta del vendedor vencio (TS-053). Periodico; procesador en
   * `modules/disputes`.
   */
  DISPUTES_ESCALATE_EXPIRED: 'disputes-escalate-expired',
} as const satisfies Record<string, string>;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

/**
 * Defaults de reintento para todos los jobs.
 *
 * Backoff exponencial porque la mayoria de los jobs previstos hablan con
 * terceros (architecture.md §8: reintentos con backoff). Un job que consume un
 * evento externo DEBE ademas ser idempotente por su cuenta: reintentar no puede
 * duplicar efectos.
 */
export const defaultJobOptions: JobsOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 1000 },
  // Se conserva un historial acotado para poder diagnosticar sin llenar Redis.
  removeOnComplete: { age: 24 * 3600, count: 1000 },
  removeOnFail: { age: 7 * 24 * 3600 },
};

const registry = new Map<string, Queue>();

/**
 * Crea (o devuelve) una cola con la configuracion estandar del proyecto.
 * Una sola instancia por nombre de cola y por proceso.
 */
export function getQueue<TData = unknown, TResult = unknown>(
  name: string,
  options: Partial<QueueOptions> = {},
): Queue<TData, TResult> {
  const existing = registry.get(name);
  if (existing) return existing as Queue<TData, TResult>;

  const queue = new Queue<TData, TResult>(name, {
    connection: getRedisClient(),
    defaultJobOptions,
    ...options,
  });

  registry.set(name, queue as Queue);
  return queue;
}

/** Colas instanciadas en este proceso. */
export function getRegisteredQueues(): readonly Queue[] {
  return [...registry.values()];
}

/** Cierra todas las colas. Para apagado ordenado. */
export async function closeQueues(): Promise<void> {
  await Promise.all([...registry.values()].map((queue) => queue.close()));
  registry.clear();
}
