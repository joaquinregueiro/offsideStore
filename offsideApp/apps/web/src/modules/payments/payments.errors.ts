import { AuthError } from '../auth/auth.errors';

/**
 * Errores del modulo payments.
 *
 * Reutilizan `AuthError` para que el mapa de traduccion a HTTP de `lib/http.ts`
 * siga siendo uno solo. No conocen HTTP.
 */

export const orderNotFound = (): AuthError =>
<<<<<<< HEAD
  new AuthError('ORDER_NOT_FOUND', 'Esa orden no existe');

/** La orden existe pero su estado no admite iniciar un pago. */
export const orderNotPayable = (): AuthError =>
  new AuthError('ORDER_NOT_PAYABLE', 'Esta orden ya no está pendiente de pago');
=======
  new AuthError('ORDER_NOT_FOUND', 'La orden no existe');

/** La orden existe pero su estado no admite iniciar un pago. */
export const orderNotPayable = (): AuthError =>
  new AuthError('ORDER_NOT_PAYABLE', 'Esta orden no esta pendiente de pago');
>>>>>>> origin/main

export const paymentDeadlineExpired = (): AuthError =>
  new AuthError('PAYMENT_DEADLINE_EXPIRED', 'La ventana de pago de esta orden venció');

/**
<<<<<<< HEAD
 * La publicación se quedó sin stock entre la orden y el pago (UC-MF-3).
=======
 * La publicacion se quedo sin stock entre la orden y el pago (UC-MF-3).
>>>>>>> origin/main
 *
 * Se revisa en el checkout para **no cobrar** algo que no se puede entregar.
 */
export const orderOutOfStock = (): AuthError =>
<<<<<<< HEAD
  new AuthError('LISTING_OUT_OF_STOCK', 'La publicación se quedó sin stock');

export const paymentNotFound = (): AuthError =>
  new AuthError('PAYMENT_NOT_FOUND', 'Ese pago no existe');

export const paymentNotRefundable = (): AuthError =>
  new AuthError('PAYMENT_NOT_REFUNDABLE', 'Este pago no se puede reembolsar');
=======
  new AuthError('LISTING_OUT_OF_STOCK', 'La publicacion se quedo sin stock');

export const paymentNotFound = (): AuthError =>
  new AuthError('PAYMENT_NOT_FOUND', 'El pago no existe');

export const paymentNotRefundable = (): AuthError =>
  new AuthError('PAYMENT_NOT_REFUNDABLE', 'Este pago no puede reembolsarse');
>>>>>>> origin/main

/**
 * Mercado Pago rechazo la operacion o no respondio.
 *
 * ⚠️ Mensaje generico a proposito: el detalle tecnico va a `audit_log`, nunca a
 * la respuesta HTTP.
 */
export const paymentProviderError = (): AuthError =>
<<<<<<< HEAD
  new AuthError('PAYMENT_PROVIDER_ERROR', 'No se pudo completar la operación con Mercado Pago');
=======
  new AuthError('PAYMENT_PROVIDER_ERROR', 'No se pudo completar la operacion con Mercado Pago');
>>>>>>> origin/main

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
<<<<<<< HEAD
  new AuthError('ORDER_NOT_PAYABLE', 'La orden no tiene comisión calculada');
=======
  new AuthError('ORDER_NOT_PAYABLE', 'La orden no tiene comision calculada');
>>>>>>> origin/main
