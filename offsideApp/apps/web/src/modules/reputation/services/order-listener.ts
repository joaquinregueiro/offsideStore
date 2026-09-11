import { onOrderTransition } from '../../orders/services/order-events';
import { evaluateSellerTier, notifyTierChange } from '../../sellers/services/seller-tier.service';
import { onOrderCancelled, onOrderCompleted } from './reputation.service';

/**
 * Lo que la CONFIANZA hace cuando una orden llega a su final.
 *
 * Igual que los avisos, se engancha por el registro de listeners de `orders`
 * y lo activa `instrumentation.ts`. `orders` no importa esto.
 *
 * ⚠️ DOS EFECTOS DISTINTOS Y SE HACEN EN ESTE ORDEN:
 *
 * 1. **Los HECHOS y la reputacion** (`onOrderCompleted`): escribe
 *    `SALE_COMPLETED` y `PURCHASE_COMPLETED` en `user_history_events` —la
 *    fuente de verdad de DEC-036— y recalcula `seller_reputations` y el nivel
 *    de usuario de las dos partes.
 *
 * 2. **El NIVEL del vendedor** (`evaluateSellerTier`): cuenta ventas
 *    COMPLETED y sube de tier si corresponde. Va DESPUES porque cuenta sobre
 *    los hechos que el paso anterior acaba de escribir; al reves, la venta que
 *    dispara el ascenso no contaria hasta la siguiente.
 *
 * ⚠️ NINGUNO PUEDE ROMPER LA TRANSICION: la orden ya esta cerrada. Un fallo
 * acá deja la reputacion desactualizada hasta la proxima venta, que es
 * recuperable —`recomputeSellerReputation` es una proyeccion, no un
 * acumulador—, y por eso no se reintenta en linea.
 */

let registrado = false;

export function registerReputationListeners(): void {
  if (registrado) return;
  registrado = true;

  onOrderTransition(async (evento) => {
    if (evento.to === 'COMPLETED') {
      try {
        await onOrderCompleted(evento.orderId);
      } catch (error) {
        console.error(
          `[reputation] no se pudieron registrar los hechos de ${evento.orderNumber}:`,
          error instanceof Error ? error.message : String(error),
        );
      }

      try {
        const evaluacion = await evaluateSellerTier(evento.sellerId);

        // Solo se avisa cuando el nivel CAMBIO: un email por venta diciendo
        // "seguís en Inicial" seria ruido, y el progreso ya se ve en el panel.
        if (evaluacion.changed && evaluacion.tier !== null) {
          await notifyTierChange(evento.sellerId, evaluacion.tier);
        }
      } catch (error) {
        console.error(
          `[sellers] no se pudo evaluar el nivel del vendedor ${evento.sellerId}:`,
          error instanceof Error ? error.message : String(error),
        );
      }

      return;
    }

    if (evento.to === 'CANCELLED') {
      try {
        await onOrderCancelled(evento.orderId);
      } catch (error) {
        console.error(
          `[reputation] no se pudo registrar la cancelacion de ${evento.orderNumber}:`,
          error instanceof Error ? error.message : String(error),
        );
      }
    }
  });
}
