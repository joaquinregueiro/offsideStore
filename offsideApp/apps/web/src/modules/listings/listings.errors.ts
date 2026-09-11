import { AuthError } from '../auth/auth.errors';

/**
 * Errores del modulo listings.
 *
 * Reutilizan `AuthError` para que el mapa de traduccion a HTTP de `lib/http.ts`
 * siga siendo uno solo. No conocen HTTP.
 */

export const invalidCategory = (): AuthError =>
  new AuthError('VALIDATION_FAILED', 'Esa categoría no existe o no está disponible');

/**
 * Faltan los atributos obligatorios de camiseta.
 *
 * El ERD §9.1 marca `kit_type` y `sleeve` como obligatorios para la categoria
 * `camiseta` y aclara que **se valida en la app, no con un CHECK**. Esto es esa
 * validacion; no es una regla nueva.
 */
export const missingShirtAttributes = (): AuthError =>
  new AuthError('VALIDATION_FAILED', 'Para una camiseta hay que elegir el tipo y las mangas');

/**
 * El vendedor no puede operar: sin aprobar o sin Mercado Pago conectado.
 *
 * ⚠️ Mensaje generico a proposito, igual que en `orders`.
 */
export const sellerNotOperational = (): AuthError =>
  new AuthError(
    'SELLER_NOT_OPERATIONAL',
    'Todavía no podés publicar: te falta completar la habilitación',
  );

/* ------------------------------------------------- imagenes (PS-010/PS-012) */

/**
 * Esa publicación no existe, o existe y no es de quien la pide.
 *
 * ⚠️ UN SOLO ERROR PARA LOS DOS CASOS, a proposito: distinguirlos permitiria
 * averiguar que publicaciones existen probando ids.
 */
export const listingNotFound = (): AuthError =>
  new AuthError('LISTING_NOT_FOUND', 'Esa publicación no existe');

export const imageNotFound = (): AuthError =>
  new AuthError('LISTING_IMAGE_NOT_FOUND', 'Esa foto no existe');

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
    'Es la única foto de una publicación activa. Subí otra antes de borrar ésta',
  );

/* ------------------------------------------ ciclo de vida (SS-040 / SS-050) */

/** Una publicacion eliminada es historia: no se edita ni se revive. */
export const listingDeleted = (): AuthError =>
  new AuthError('LISTING_DELETED', 'Esa publicación fue eliminada');

export const listingNotPausable = (): AuthError =>
  new AuthError('LISTING_NOT_PAUSABLE', 'Sólo se puede pausar una publicación que esté a la venta');

export const listingNotResumable = (): AuthError =>
  new AuthError('LISTING_NOT_RESUMABLE', 'Sólo se puede reactivar una publicación pausada');

/**
 * Reactivar exige al menos una foto (PS-010).
 *
 * Sin esto, borrar las fotos con la publicacion pausada y reactivarla seria la
 * puerta de atras a la regla.
 */
export const imageRequiredToPublish = (): AuthError =>
  new AuthError(
    'IMAGE_REQUIRED',
    'Necesita al menos una foto para volver a la venta. Subí una y reactivala',
  );

/* ------------------------------------------------ promociones (PS-021 ⚙️) */

/**
 * ⚠️ LOS CODIGOS SE REUSAN A PROPOSITO. `AuthErrorCode` y el mapa
 * `STATUS_BY_CODE` de `lib/http.ts` son cerrados y viven fuera de este modulo;
 * agregar `PROMOTION_*` ahi es un cambio de otro paquete. Mientras tanto se
 * usan los codigos existentes que traducen al HTTP correcto: `FORBIDDEN` (403)
 * para una funcionalidad apagada desde Admin y `LISTING_NOT_AVAILABLE` (409)
 * para un estado que no admite la operacion. El mensaje es lo que ve la
 * persona, y ese si es propio.
 */

/** `feature_promotions` esta en `false` en el Config Store. */
export const promotionsDisabled = (): AuthError =>
  new AuthError('FORBIDDEN', 'Las promociones no están habilitadas por el momento');

/** Solo se promociona lo que esta a la venta: una pausada o agotada no se ve. */
export const listingNotPromotable = (): AuthError =>
  new AuthError(
    'LISTING_NOT_AVAILABLE',
    'Sólo se puede promocionar una publicación que esté a la venta',
  );

/** Ya hay una promocion vigente: no se apilan ni se extienden. */
export const listingAlreadyPromoted = (): AuthError =>
  new AuthError('LISTING_NOT_AVAILABLE', 'Esa publicación ya está promocionada');

/** No hay promocion vigente que cancelar. */
export const promotionNotFound = (): AuthError =>
  new AuthError('LISTING_NOT_AVAILABLE', 'Esa publicación no tiene una promoción vigente');

/**
 * Terminar una promocion desde Admin exige un motivo: le cambia la comision
 * a alguien que acepto otra cosa, y "sin motivo" no se puede explicar despues.
 */
export const promotionReasonRequired = (): AuthError =>
  new AuthError('VALIDATION_FAILED', 'Indicá el motivo para terminar la promoción');

/* ------------------------------------------- envio declarado (shipping.md) */

export const invalidShippingMode = (): AuthError =>
  new AuthError('VALIDATION_FAILED', 'Elegí cómo se resuelve el envío');

/** `buyer_pays` sin importe, o con importe cero, no dice nada al comprador. */
export const shippingCostRequired = (): AuthError =>
  new AuthError(
    'VALIDATION_FAILED',
    'Si el envío lo paga el comprador, indicá cuánto cuesta (mayor a cero)',
  );

/** Un importe en un modo que no lo usa es un dato que nadie va a leer. */
export const shippingCostNotApplicable = (): AuthError =>
  new AuthError(
    'VALIDATION_FAILED',
    'El costo de envío sólo se indica cuando lo paga el comprador',
  );

/** `shipping_pickup_allowed` esta en `false` en el Config Store. */
export const pickupNotAllowed = (): AuthError =>
  new AuthError('VALIDATION_FAILED', 'El retiro en persona no está habilitado por el momento');

/** `shipping_to_agree_allowed` esta en `false` (o no existe) en el Config Store. */
export const toAgreeNotAllowed = (): AuthError =>
  new AuthError(
    'VALIDATION_FAILED',
    'El envío a convenir no está habilitado: indicá si está incluido, cuánto cuesta o si es retiro',
  );

/* ----------------------------------------------------- busqueda (PS-023) */

export const invalidPriceRange = (motivo: string): AuthError =>
  new AuthError('VALIDATION_FAILED', `El rango de precios no es válido: ${motivo}`);

export const invalidSearchOrder = (): AuthError =>
  new AuthError('VALIDATION_FAILED', 'Ese orden de resultados no existe');
