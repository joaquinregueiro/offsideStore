import { AuthError } from '../auth/auth.errors';

/**
 * Errores del modulo orders.
 *
 * Reutilizan `AuthError` para que el mapa de traduccion a HTTP de `lib/http.ts`
 * siga siendo uno solo. No conocen HTTP.
 */

export const listingNotAvailable = (): AuthError =>
  new AuthError('LISTING_NOT_AVAILABLE', 'Esa publicación ya no está a la venta');

export const listingOutOfStock = (): AuthError =>
  new AuthError('LISTING_OUT_OF_STOCK', 'No queda stock suficiente');

/**
 * El vendedor no puede operar.
 *
 * ⚠️ Mensaje generico: no distingue entre "no aprobado" y "sin Mercado Pago
 * conectado". El comprador no tiene por que enterarse del estado interno del
 * vendedor.
 */
export const sellerNotOperational = (): AuthError =>
  new AuthError('SELLER_NOT_OPERATIONAL', 'Este vendedor no puede recibir compras en este momento');

/** Comprar la propia publicacion. */
export const cannotBuyOwnListing = (): AuthError =>
  new AuthError('FORBIDDEN', 'No podés comprar tu propia publicación');

/**
 * La orden no existe o no es de quien pregunta.
 *
 * ⚠️ UN SOLO ERROR PARA LOS DOS CASOS: distinguirlos permitiria enumerar
 * ordenes ajenas. Mismo criterio que `payments.startCheckout` y `getMyOrder`.
 */
export const orderNotFound = (): AuthError =>
  new AuthError('ORDER_NOT_FOUND', 'No encontramos esa orden');

/**
 * La orden esta en un estado desde el que esa accion no se puede hacer
 * (DEC-029: la maquina de estados de `order-transitions.ts`).
 *
 * ⚠️ Reusa `ORDER_NOT_PAYABLE` (409) porque `AuthErrorCode` es una union
 * cerrada en `auth.errors.ts` y no es de este paquete. Pedido: un codigo
 * `ORDER_INVALID_TRANSITION` con 409 en `lib/http.ts`.
 */
export const orderInvalidTransition = (accion: string): AuthError =>
  new AuthError('ORDER_NOT_PAYABLE', `Esta orden no se puede ${accion} en su estado actual`);

/** El vendedor tiene que decir por que cancela: queda en el historial y en la auditoria. */
export const cancelReasonRequired = (): AuthError =>
  new AuthError(
    'VALIDATION_FAILED',
    'Contanos el motivo de la cancelación (entre 5 y 500 caracteres)',
  );
