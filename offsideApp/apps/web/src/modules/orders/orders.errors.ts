import { AuthError } from '../auth/auth.errors';

/**
 * Errores del modulo orders.
 *
 * Reutilizan `AuthError` para que el mapa de traduccion a HTTP de `lib/http.ts`
 * siga siendo uno solo. No conocen HTTP.
 */

export const listingNotAvailable = (): AuthError =>
<<<<<<< HEAD
  new AuthError('LISTING_NOT_AVAILABLE', 'Esa publicación ya no está a la venta');

export const listingOutOfStock = (): AuthError =>
  new AuthError('LISTING_OUT_OF_STOCK', 'No queda stock suficiente');
=======
  new AuthError('LISTING_NOT_AVAILABLE', 'La publicacion no esta disponible para comprar');

export const listingOutOfStock = (): AuthError =>
  new AuthError('LISTING_OUT_OF_STOCK', 'No hay stock suficiente para esa cantidad');
>>>>>>> origin/main

/**
 * El vendedor no puede operar.
 *
 * ⚠️ Mensaje generico: no distingue entre "no aprobado" y "sin Mercado Pago
 * conectado". El comprador no tiene por que enterarse del estado interno del
 * vendedor.
 */
export const sellerNotOperational = (): AuthError =>
<<<<<<< HEAD
  new AuthError('SELLER_NOT_OPERATIONAL', 'Este vendedor no puede recibir compras en este momento');

/** Comprar la propia publicacion. */
export const cannotBuyOwnListing = (): AuthError =>
  new AuthError('FORBIDDEN', 'No podés comprar tu propia publicación');
=======
  new AuthError('SELLER_NOT_OPERATIONAL', 'El vendedor no puede recibir compras en este momento');

/** Comprar la propia publicacion. */
export const cannotBuyOwnListing = (): AuthError =>
  new AuthError('FORBIDDEN', 'No podes comprar tu propia publicacion');
>>>>>>> origin/main
