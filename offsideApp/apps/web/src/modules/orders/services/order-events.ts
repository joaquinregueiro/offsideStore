import type { OrderStatus, TransitionActor } from './order-transitions';

/**
 * Hooks de salida del ciclo de la orden.
 *
 * `orders` NO llama a notificaciones, emails ni reputacion: son de otros
 * modulos, y acoplarlos aca invertiria la dependencia (cada uno importaria a
 * `orders` y `orders` a cada uno). En cambio, cada transicion que este modulo
 * ejecuta se ANUNCIA por aca, y quien quiera reaccionar se registra con
 * `onOrderTransition()` desde `instrumentation.ts` (o desde su propio modulo
 * al cargar).
 *
 * ⚠️ SE EMITE DESPUES DEL COMMIT, nunca adentro de la transaccion. Un listener
 * que manda un email no puede correr sobre una orden que todavia puede
 * deshacerse. Consecuencia: `PENDING_PAYMENT → PAID` y `PAID → PROCESSING`
 * NO se anuncian desde aca, porque ocurren dentro de la transaccion de
 * `payments` (`aplicarAprobacion`) y `orders` no sabe cuando esa transaccion
 * termina. Anotado en NECESITA-DE-OTROS: `payments` las emite al salir.
 *
 * ⚠️ UN LISTENER QUE FALLA NO ROMPE LA TRANSICION: ya esta escrita. El error
 * se registra y se sigue con el siguiente. Si un efecto necesita garantia de
 * entrega, el listener encola un job (BullMQ) y termina; no hace el trabajo
 * en linea.
 */

export interface OrderTransitionEvent {
  orderId: string;
  orderNumber: string;
  buyerId: string;
  sellerId: string;
  from: OrderStatus;
  to: OrderStatus;
  actor: TransitionActor;
  /** `users.id` de quien hizo la transicion; null para el sistema. */
  actorUserId: string | null;
  occurredAt: Date;
  /** Motivo declarado (cancelaciones) o nota del historial. */
  note: string | null;
}

export type OrderTransitionListener = (event: OrderTransitionEvent) => Promise<void> | void;

const listeners = new Set<OrderTransitionListener>();

/** Registra un listener. Devuelve la funcion que lo saca. */
export function onOrderTransition(listener: OrderTransitionListener): () => void {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

/**
 * Anuncia una transicion YA COMMITEADA a todos los listeners, en orden de
 * registro. Nunca lanza.
 */
export async function emitOrderTransition(event: OrderTransitionEvent): Promise<void> {
  for (const listener of listeners) {
    try {
      await listener(event);
    } catch (error) {
      console.error(
        `[orders] listener fallo en ${event.from} → ${event.to} de ${event.orderNumber}:`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }
}

/** Solo para tests: vacia el registro. */
export function _clearOrderTransitionListeners(): void {
  listeners.clear();
}
