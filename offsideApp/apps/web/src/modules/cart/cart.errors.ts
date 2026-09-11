import { AuthError } from '../auth/auth.errors';

/**
 * Errores del modulo cart (BS-060/061/062, DEC-026, ERD §10).
 *
 * Reutilizan `AuthError`: los codigos de `orders` —`LISTING_NOT_AVAILABLE`,
 * `LISTING_OUT_OF_STOCK`, `SELLER_NOT_OPERATIONAL`— significan exactamente lo
 * mismo aca, y los mensajes llevan el TITULO de la publicacion porque en un
 * carrito con cinco lineas "no queda stock" no dice de cual.
 */

/** `feature_cart` esta en `false` en el Config Store. */
export const cartDisabled = (): AuthError =>
  new AuthError('FORBIDDEN', 'El carrito no está habilitado por el momento');

export const listingNotAvailable = (title?: string): AuthError =>
  new AuthError(
    'LISTING_NOT_AVAILABLE',
    title === undefined
      ? 'Esa publicación ya no está a la venta'
      : `"${title}" ya no está a la venta`,
  );

export const listingOutOfStock = (title: string, disponible: number): AuthError =>
  new AuthError(
    'LISTING_OUT_OF_STOCK',
    disponible === 0
      ? `"${title}" se quedó sin stock`
      : `De "${title}" ${disponible === 1 ? 'queda 1 unidad' : `quedan ${disponible} unidades`}`,
  );

/** Mensaje generico a proposito, igual que en `orders`. */
export const sellerNotOperational = (title: string): AuthError =>
  new AuthError(
    'SELLER_NOT_OPERATIONAL',
    `El vendedor de "${title}" no puede recibir compras en este momento`,
  );

export const cannotBuyOwnListing = (): AuthError =>
  new AuthError('FORBIDDEN', 'No podés agregar tu propia publicación al carrito');

export const invalidQuantity = (maximo: number): AuthError =>
  new AuthError('VALIDATION_FAILED', `La cantidad tiene que ser un entero entre 1 y ${maximo}`);

/** La publicacion no esta en el carrito. */
export const itemNotInCart = (): AuthError =>
  new AuthError('VALIDATION_FAILED', 'Esa publicación no está en tu carrito');

export const cartEmpty = (): AuthError =>
  new AuthError('VALIDATION_FAILED', 'Tu carrito está vacío');

/** La configuracion del carrito no esta cargada en `app_settings`. */
export const settingNotConfigured = (key: string): AuthError =>
  new AuthError('SETTING_NOT_CONFIGURED', `La configuración "${key}" no está cargada`);
