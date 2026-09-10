import { getEnv } from '@offside/config';

import { createFakeShipping } from './fake-shipping.adapter';
import type { ShippingPort } from './shipping.port';

/**
 * Elige el adaptador de envios.
 *
 * Hoy hay UNO SOLO, el simulado, y la fabrica existe igual por dos razones:
 * para que el dominio nunca importe un adaptador concreto —el dia que exista el
 * de Correo Argentino, no se toca ni un Service— y para poder poner la regla de
 * seguridad de abajo en un solo lugar.
 *
 * =============================================================================
 * ⚠️ EN PRODUCCION SE ROMPE A PROPOSITO
 * =============================================================================
 *
 * Mismo criterio que `createStorage()` y `createEmailSender()`, y aca el motivo
 * es peor que perder archivos: **un envio simulado informa "entregado"**. Eso
 * cerraria ordenes que nunca se despacharon, liberaria la plata del vendedor y
 * destruiria la evidencia con la que SH-002 resuelve las disputas de "producto
 * no recibido". Un comprador que no recibio nada se quedaria sin nada.
 *
 * Es preferible que la operacion falle ruidosamente a que mienta en silencio.
 *
 * ⚠️ NO HAY VARIABLE PARA FORZARLO. Una `SHIPPING_PROVIDER=fake` seria
 * exactamente el interruptor que alguien termina activando en produccion para
 * "salir del paso". Cuando exista el adaptador real, esta funcion elige por
 * presencia de credenciales, igual que storage.
 */
export function createShipping(): ShippingPort {
  if (getEnv().APP_ENV === 'production') {
    throw new Error(
      'No hay proveedor de envios configurado. El adaptador simulado NO puede ' +
        'usarse en produccion: informaria envios entregados que nunca salieron. ' +
        'Falta la integracion con Correo Argentino (ver ' +
        'docs-implementation/correo-argentino-spec.md).',
    );
  }

  return createFakeShipping();
}

export { ShippingError } from './shipping.port';
export type {
  Agency,
  CreateShipmentInput,
  CreatedShipment,
  DeliveryMode,
  PackageInfo,
  QuoteInput,
  ShipmentStatus,
  ShippingAddress,
  ShippingFailure,
  ShippingLabel,
  ShippingPort,
  ShippingRate,
  TrackingEvent,
  TrackingResult,
} from './shipping.port';
