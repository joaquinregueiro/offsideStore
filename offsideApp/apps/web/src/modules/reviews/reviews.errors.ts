import { AuthError } from '../auth/auth.errors';

/**
 * Errores del modulo reviews (BS-100/101, ERD §15).
 *
 * Reutilizan `AuthError` para que el mapa de traduccion a HTTP de `lib/http.ts`
 * siga siendo uno solo. No conocen HTTP.
 *
 * ⚠️ `AuthErrorCode` es una union cerrada de `auth/auth.errors.ts`, que no es
 * de este modulo: se reusan codigos existentes con el estado HTTP mas
 * cercano, igual que `reputation.errors.ts`. Cuando existan
 * `REVIEW_NOT_FOUND` (404), `REVIEW_ALREADY_EXISTS` (409),
 * `REVIEW_WINDOW_CLOSED` (422), `REVIEWS_DISABLED` (403) y
 * `REVIEW_ALREADY_REPLIED` (409), alcanza con cambiar el primer argumento.
 */

/** `feature_reviews` esta apagado (⚙️ configuration-registry §3). */
export const reviewsDisabled = (): AuthError =>
  new AuthError('FORBIDDEN', 'Las calificaciones no están habilitadas por ahora');

export const orderNotFound = (): AuthError =>
  new AuthError('ORDER_NOT_FOUND', 'Esa orden no existe');

/** Solo el comprador de la orden califica. 403 sin distinguir "no existe" de "no es tuya". */
export const notOrderBuyer = (): AuthError =>
  new AuthError('FORBIDDEN', 'Solo quien compró puede calificar esta orden');

/** BR-051: comprador y vendedor son la misma cuenta. */
export const selfReviewForbidden = (): AuthError =>
  new AuthError('FORBIDDEN', 'No podés calificar una compra a tu propia tienda');

export const orderNotCompleted = (status: string): AuthError =>
  new AuthError(
    'VALIDATION_FAILED',
    `Solo se califica una orden completada; esta está en ${status}`,
  );

export const reviewWindowClosed = (days: number): AuthError =>
  new AuthError(
    'VALIDATION_FAILED',
    `El plazo para calificar venció: son ${days} días desde que se completó la orden`,
  );

export const reviewAlreadyExists = (): AuthError =>
  new AuthError('VALIDATION_FAILED', 'Esta orden ya tiene una calificación');

export const ratingInvalid = (min: number, max: number): AuthError =>
  new AuthError('VALIDATION_FAILED', `El puntaje tiene que ser un entero entre ${min} y ${max}`);

export const commentTooLong = (max: number): AuthError =>
  new AuthError('VALIDATION_FAILED', `El comentario no puede superar ${max} caracteres`);

/** Mismo criterio que `reputation.errors.ts`: no existe = 403 generico. */
export const reviewNotFound = (): AuthError =>
  new AuthError('FORBIDDEN', 'Esa calificación no existe');

export const notReviewedSeller = (): AuthError =>
  new AuthError('FORBIDDEN', 'Solo el vendedor calificado puede responder');

export const replyRequired = (): AuthError =>
  new AuthError('VALIDATION_FAILED', 'Escribí una respuesta');

export const replyTooLong = (max: number): AuthError =>
  new AuthError('VALIDATION_FAILED', `La respuesta no puede superar ${max} caracteres`);

export const replyAlreadyExists = (): AuthError =>
  new AuthError('VALIDATION_FAILED', 'Esta calificación ya tiene una respuesta');

/** Ocultar una reseña es moderar: sin la capacidad, 403. */
export const hideForbidden = (): AuthError =>
  new AuthError('FORBIDDEN', 'No tenés permiso para ocultar calificaciones');

/**
 * Ocultar exige columnas que `reviews` no tiene (ver `hideReview`). NO es un
 * error de dominio ni de quien llama: es una capacidad que falta en el
 * esquema, y por eso es un `Error` comun que `lib/http.ts` traduce a 500.
 */
export class ReviewModerationUnavailableError extends Error {
  constructor() {
    super(
      'Ocultar calificaciones requiere migración: faltan `reviews.hidden_at`, `reviews.hidden_by` y `reviews.hidden_reason`',
    );
    this.name = 'ReviewModerationUnavailableError';
  }
}
