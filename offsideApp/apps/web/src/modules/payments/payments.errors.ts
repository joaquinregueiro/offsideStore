import { AuthError } from '../auth/auth.errors';

/**
 * Errores del modulo payments.
 *
 * Reutilizan `AuthError` para que el mapa de traduccion a HTTP de `lib/http.ts`
 * siga siendo uno solo. No conocen HTTP.
 */

export const orderNotFound = (): AuthError =>
  new AuthError('ORDER_NOT_FOUND', 'La orden no existe');

/** La orden existe pero su estado no admite iniciar un pago. */
export const orderNotPayable = (): AuthError =>
  new AuthError('ORDER_NOT_PAYABLE', 'Esta orden no esta pendiente de pago');

export const paymentDeadlineExpired = (): AuthError =>
  new AuthError('PAYMENT_DEADLINE_EXPIRED', 'La ventana de pago de esta orden venció');

/**
 * La publicacion se quedo sin stock entre la orden y el pago (UC-MF-3).
 *
 * Se revisa en el checkout para **no cobrar** algo que no se puede entregar.
 */
export const orderOutOfStock = (): AuthError =>
  new AuthError('LISTING_OUT_OF_STOCK', 'La publicacion se quedo sin stock');

export const paymentNotFound = (): AuthError =>
  new AuthError('PAYMENT_NOT_FOUND', 'El pago no existe');

export const paymentNotRefundable = (): AuthError =>
  new AuthError('PAYMENT_NOT_REFUNDABLE', 'Este pago no puede reembolsarse');

/**
 * Mercado Pago rechazo la operacion o no respondio.
 *
 * ⚠️ Mensaje generico a proposito: el detalle tecnico va a `audit_log`, nunca a
 * la respuesta HTTP.
 */
export const paymentProviderError = (): AuthError =>
  new AuthError('PAYMENT_PROVIDER_ERROR', 'No se pudo completar la operacion con Mercado Pago');

export const refundAmountInvalid = (message: string): AuthError =>
  new AuthError('REFUND_AMOUNT_INVALID', message);

/**
 * La orden no tiene snapshot de comision.
 *
 * No deberia pasar: `orders` calcula la comision al crear la orden (DEC-030).
 * Si pasa, es un bug de datos y **no se calcula al vuelo**, porque recalcular
 * con configuracion actual es exactamente lo que DEC-030 prohibe.
 */
export const orderWithoutCommissionSnapshot = (): AuthError =>
  new AuthError('ORDER_NOT_PAYABLE', 'La orden no tiene comision calculada');
