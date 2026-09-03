import { AuthError } from '../auth/auth.errors';

/**
 * Errores del modulo listings.
 *
 * Reutilizan `AuthError` para que el mapa de traduccion a HTTP de `lib/http.ts`
 * siga siendo uno solo. No conocen HTTP.
 */

export const invalidCategory = (): AuthError =>
  new AuthError('VALIDATION_FAILED', 'La categoria no existe o no esta activa');

/**
 * Faltan los atributos obligatorios de camiseta.
 *
 * El ERD §9.1 marca `kit_type` y `sleeve` como obligatorios para la categoria
 * `camiseta` y aclara que **se valida en la app, no con un CHECK**. Esto es esa
 * validacion; no es una regla nueva.
 */
export const missingShirtAttributes = (): AuthError =>
  new AuthError(
    'VALIDATION_FAILED',
    'Para una camiseta hay que indicar el tipo de kit (kitType) y la manga (sleeve)',
  );

/**
 * El vendedor no puede operar: sin aprobar o sin Mercado Pago conectado.
 *
 * ⚠️ Mensaje generico a proposito, igual que en `orders`.
 */
export const sellerNotOperational = (): AuthError =>
  new AuthError('SELLER_NOT_OPERATIONAL', 'Todavia no podes publicar: tu cuenta no esta operativa');

/* ------------------------------------------------- imagenes (PS-010/PS-012) */

/**
 * La publicacion no existe, o existe y no es de quien la pide.
 *
 * ⚠️ UN SOLO ERROR PARA LOS DOS CASOS, a proposito: distinguirlos permitiria
 * averiguar que publicaciones existen probando ids.
 */
export const listingNotFound = (): AuthError =>
  new AuthError('LISTING_NOT_FOUND', 'La publicacion no existe');

export const imageNotFound = (): AuthError =>
  new AuthError('LISTING_IMAGE_NOT_FOUND', 'La imagen no existe');

/** El archivo no se pudo decodificar, o su formato real no esta permitido. */
export const invalidImage = (detalle: string): AuthError => new AuthError('IMAGE_INVALID', detalle);

export const imageTooLarge = (maxBytes: number): AuthError =>
  new AuthError(
    'IMAGE_TOO_LARGE',
    `La imagen supera el maximo permitido (${Math.floor(maxBytes / (1024 * 1024))} MB)`,
  );

/** Cupo de fotos alcanzado. El maximo es configurable (⚙️ DEC-013). */
export const tooManyImages = (maximo: number): AuthError =>
  new AuthError('TOO_MANY_IMAGES', `Ya tenes el maximo de ${maximo} fotos en esta publicacion`);
