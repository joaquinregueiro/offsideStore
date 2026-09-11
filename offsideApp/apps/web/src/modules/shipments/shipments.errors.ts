import { AuthError } from '../auth/auth.errors';

/**
 * Errores del modulo shipments.
 *
 * Reutilizan `AuthError` para que el mapa de traduccion a HTTP de `lib/http.ts`
 * siga siendo uno solo. No conocen HTTP.
 */

/**
 * Ya existe un envio para la orden: 1 envio por orden (ERD §20.11,
 * `shipments_order_id_key`). Se llega aca solo si dos despachos corren a la vez
 * y los dos pasaron la maquina de estados; el UNIQUE es la ultima defensa.
 *
 * ⚠️ Reusa `ORDER_NOT_PAYABLE` (409) porque `AuthErrorCode` es una union
 * cerrada en `auth.errors.ts` y no es de este paquete. Pedido: un codigo
 * `SHIPMENT_ALREADY_EXISTS` con 409 en `lib/http.ts`.
 */
export const shipmentAlreadyExists = (): AuthError =>
  new AuthError('ORDER_NOT_PAYABLE', 'Esta orden ya tiene un envío registrado');

export const shipmentNotFound = (): AuthError =>
  new AuthError('ORDER_NOT_FOUND', 'No encontramos el envío de esta orden');

/** El numero de seguimiento no tiene una forma razonable. */
export const trackingNumberInvalid = (): AuthError =>
  new AuthError(
    'VALIDATION_FAILED',
    'El número de seguimiento tiene que tener entre 4 y 64 caracteres',
  );

/** El transportista no esta en la lista configurada (`shipping_carriers`). */
export const carrierUnknown = (): AuthError =>
  new AuthError('VALIDATION_FAILED', 'Elegí un transportista de la lista');

/**
 * La orden ya tiene el envio entregado o nunca se despacho: no hay nada que
 * marcar. Reusa `ORDER_NOT_PAYABLE` (409) por el mismo motivo que
 * `shipmentAlreadyExists`.
 */
export const shipmentNotDeliverable = (): AuthError =>
  new AuthError('ORDER_NOT_PAYABLE', 'Este envío no se puede marcar como entregado');
