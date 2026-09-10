import { AuthError } from '../auth/auth.errors';

/**
 * Errores del modulo listings.
 *
 * Reutilizan `AuthError` para que el mapa de traduccion a HTTP de `lib/http.ts`
 * siga siendo uno solo. No conocen HTTP.
 */

export const invalidCategory = (): AuthError =>
<<<<<<< HEAD
  new AuthError('VALIDATION_FAILED', 'Esa categoría no existe o no está disponible');
=======
  new AuthError('VALIDATION_FAILED', 'La categoria no existe o no esta activa');
>>>>>>> origin/main

/**
 * Faltan los atributos obligatorios de camiseta.
 *
 * El ERD §9.1 marca `kit_type` y `sleeve` como obligatorios para la categoria
 * `camiseta` y aclara que **se valida en la app, no con un CHECK**. Esto es esa
 * validacion; no es una regla nueva.
 */
export const missingShirtAttributes = (): AuthError =>
<<<<<<< HEAD
  new AuthError('VALIDATION_FAILED', 'Para una camiseta hay que elegir el tipo y las mangas');
=======
  new AuthError(
    'VALIDATION_FAILED',
    'Para una camiseta hay que indicar el tipo de kit (kitType) y la manga (sleeve)',
  );
>>>>>>> origin/main

/**
 * El vendedor no puede operar: sin aprobar o sin Mercado Pago conectado.
 *
 * ⚠️ Mensaje generico a proposito, igual que en `orders`.
 */
export const sellerNotOperational = (): AuthError =>
<<<<<<< HEAD
  new AuthError(
    'SELLER_NOT_OPERATIONAL',
    'Todavía no podés publicar: te falta completar la habilitación',
  );
=======
  new AuthError('SELLER_NOT_OPERATIONAL', 'Todavia no podes publicar: tu cuenta no esta operativa');
>>>>>>> origin/main

/* ------------------------------------------------- imagenes (PS-010/PS-012) */

/**
<<<<<<< HEAD
 * Esa publicación no existe, o existe y no es de quien la pide.
=======
 * La publicacion no existe, o existe y no es de quien la pide.
>>>>>>> origin/main
 *
 * ⚠️ UN SOLO ERROR PARA LOS DOS CASOS, a proposito: distinguirlos permitiria
 * averiguar que publicaciones existen probando ids.
 */
export const listingNotFound = (): AuthError =>
<<<<<<< HEAD
  new AuthError('LISTING_NOT_FOUND', 'Esa publicación no existe');

export const imageNotFound = (): AuthError =>
  new AuthError('LISTING_IMAGE_NOT_FOUND', 'Esa foto no existe');
=======
  new AuthError('LISTING_NOT_FOUND', 'La publicacion no existe');

export const imageNotFound = (): AuthError =>
  new AuthError('LISTING_IMAGE_NOT_FOUND', 'La imagen no existe');
>>>>>>> origin/main

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

/**
 * Se intento borrar la unica foto de una publicacion ACTIVA.
 *
 * PS-010 exige al menos una foto. Se rechaza en vez de bajar la publicacion a
 * borrador en silencio: dejar de vender sin enterarse es peor que un error.
 */
export const lastImageOfActiveListing = (): AuthError =>
  new AuthError(
    'LAST_IMAGE_REQUIRED',
<<<<<<< HEAD
    'Es la única foto de una publicación activa. Subí otra antes de borrar ésta',
=======
    'Es la unica foto de una publicacion activa. Subi otra antes de borrar esta',
>>>>>>> origin/main
  );

/* ------------------------------------------ ciclo de vida (SS-040 / SS-050) */

/** Una publicacion eliminada es historia: no se edita ni se revive. */
export const listingDeleted = (): AuthError =>
<<<<<<< HEAD
  new AuthError('LISTING_DELETED', 'Esa publicación fue eliminada');

export const listingNotPausable = (): AuthError =>
  new AuthError('LISTING_NOT_PAUSABLE', 'Sólo se puede pausar una publicación que esté a la venta');

export const listingNotResumable = (): AuthError =>
  new AuthError('LISTING_NOT_RESUMABLE', 'Sólo se puede reactivar una publicación pausada');
=======
  new AuthError('LISTING_DELETED', 'Esa publicacion fue eliminada');

export const listingNotPausable = (): AuthError =>
  new AuthError('LISTING_NOT_PAUSABLE', 'Solo se puede pausar una publicacion que este a la venta');

export const listingNotResumable = (): AuthError =>
  new AuthError('LISTING_NOT_RESUMABLE', 'Solo se puede reactivar una publicacion pausada');
>>>>>>> origin/main

/**
 * Reactivar exige al menos una foto (PS-010).
 *
 * Sin esto, borrar las fotos con la publicacion pausada y reactivarla seria la
 * puerta de atras a la regla.
 */
export const imageRequiredToPublish = (): AuthError =>
  new AuthError(
    'IMAGE_REQUIRED',
<<<<<<< HEAD
    'Necesita al menos una foto para volver a la venta. Subí una y reactivala',
=======
    'Necesita al menos una foto para volver a la venta. Subi una y reactivala',
>>>>>>> origin/main
  );
