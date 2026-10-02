import { getEnv } from '@offside/config';

import { createAndreaniShipping } from '../andreani/andreani.adapter';
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
/**
 * El proveedor de envios que corresponde a este entorno.
 *
 * ⚠️ CON CREDENCIAL DE ANDREANI, ANDREANI, EN CUALQUIER ENTORNO. La API PyME no
 * tiene ambiente de pruebas: la credencial es de la cuenta real. Cargarla en un
 * `.env` de desarrollo da de alta envios reales "por pagar" en esa cuenta, y eso
 * se elige a sabiendas, no por default.
 *
 * ⚠️ SIN CREDENCIAL, EL SIMULADO, SALVO EN PRODUCCION, donde se rompe a
 * proposito: un envio simulado informa "entregado" y cerraria ordenes que nunca
 * se despacharon. Quien llama tiene que preguntar `envioAutomaticoDisponible()`
 * antes y caer al despacho manual.
 */
export function createShipping(): ShippingPort {
  const credencial = getEnv().ANDREANI_CREDENCIAL;
  if (credencial !== undefined) return createAndreaniShipping(credencial);

  if (getEnv().APP_ENV === 'production') {
    throw new Error(
      'No hay proveedor de envios configurado. El adaptador simulado NO puede ' +
        'usarse en produccion: informaria envios entregados que nunca salieron. ' +
        'Falta ANDREANI_CREDENCIAL.',
    );
  }

  return createFakeShipping();
}

/** Si este entorno puede despachar automaticamente, real o simulado. */
export function envioAutomaticoDisponible(): boolean {
  return getEnv().ANDREANI_CREDENCIAL !== undefined || getEnv().APP_ENV !== 'production';
}

/** El nombre del proveedor activo, para guardarlo en `shipments.provider`. */
export function proveedorActivo(): 'andreani' | 'fake' {
  return getEnv().ANDREANI_CREDENCIAL !== undefined ? 'andreani' : 'fake';
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
  ShipmentLookup,
  ShipmentQuery,
  TrackingEvent,
  TrackingResult,
} from './shipping.port';
