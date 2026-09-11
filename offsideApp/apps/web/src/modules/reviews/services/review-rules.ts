import type { AuthError } from '../../auth/auth.errors';
import * as errors from '../reviews.errors';

/**
 * Reglas de la calificacion (BS-100 / BS-101 / BR-051 / ERD §15) — FUNCIONES
 * PURAS, sin base ni reloj propio. Todo lo que depende de "ahora" o de la
 * configuracion llega por parametro para que los tests fabriquen el caso.
 */

/** `reviews.rating` lleva CHECK 1..5 en la base (ERD §15). */
export const RATING_MIN = 1;
export const RATING_MAX = 5;

/**
 * Largos maximos del comentario y de la respuesta del vendedor.
 *
 * ⚠️ CONSTANTES DOCUMENTADAS, no ⚙️: la doc no fija un largo y no es una
 * regla de negocio sino un techo de cordura contra un pegado accidental de
 * diez paginas. Son los mismos 1.000 caracteres para los dos lados a
 * proposito: la respuesta es un descargo, no un derecho a extenderse mas
 * que la critica.
 */
export const COMMENT_MAX_LENGTH = 1000;
export const REPLY_MAX_LENGTH = 1000;

const MILISEGUNDOS_POR_DIA = 24 * 60 * 60 * 1000;

/** Entero entre 1 y 5. `3.5` no es un puntaje; `"4"` tampoco. */
export function validateRating(rating: unknown): number {
  if (typeof rating !== 'number' || !Number.isInteger(rating)) {
    throw errors.ratingInvalid(RATING_MIN, RATING_MAX);
  }
  if (rating < RATING_MIN || rating > RATING_MAX) {
    throw errors.ratingInvalid(RATING_MIN, RATING_MAX);
  }

  return rating;
}

/** Recorta espacios; vacio es "sin comentario", que se guarda como null. */
export function normalizeComment(comment: string | null | undefined): string | null {
  if (comment === null || comment === undefined) return null;

  const recortado = comment.trim();
  if (recortado.length === 0) return null;
  if (recortado.length > COMMENT_MAX_LENGTH) throw errors.commentTooLong(COMMENT_MAX_LENGTH);

  return recortado;
}

/** La respuesta si es obligatoria: responder con nada no es responder. */
export function normalizeReply(reply: string | null | undefined): string {
  const recortado = (reply ?? '').trim();
  if (recortado.length === 0) throw errors.replyRequired();
  if (recortado.length > REPLY_MAX_LENGTH) throw errors.replyTooLong(REPLY_MAX_LENGTH);

  return recortado;
}

/** Ultimo instante en que se puede calificar. */
export function reviewDeadline(completedAt: Date, windowDays: number): Date {
  return new Date(completedAt.getTime() + windowDays * MILISEGUNDOS_POR_DIA);
}

/**
 * Si `now` cae dentro de la ventana. La ventana se mide desde
 * `orders.completed_at`; una orden COMPLETED sin esa fecha es una
 * inconsistencia del ciclo de vida, y ante ella se deja calificar: no se
 * puede haber vencido un plazo que no se sabe cuando empezo.
 */
export function isWithinReviewWindow(
  completedAt: Date | null,
  windowDays: number,
  now: Date,
): boolean {
  if (completedAt === null) return true;

  return now.getTime() <= reviewDeadline(completedAt, windowDays).getTime();
}

export interface ReviewEligibilityInput {
  order: {
    status: string;
    buyerId: string;
    sellerUserId: string;
    completedAt: Date | null;
  };
  raterId: string;
  windowDays: number;
  now: Date;
  /** Si ya hay una reseña sobre la orden (UNIQUE(order_id), ERD §15). */
  alreadyReviewed: boolean;
}

/**
 * Todas las reglas de "puede calificar", en el orden en que se evaluan.
 * Devuelve el error que corresponde o `null` si puede.
 *
 *  1. Solo el comprador de la orden (BS-100).
 *  2. Nunca a la propia tienda (BR-051), y esto ANTES que el estado: una
 *     autocompra no debe recibir ni siquiera el mensaje de "todavia no esta
 *     completada".
 *  3. Solo orden COMPLETED (ERD §15).
 *  4. Dentro de `review_window_days`.
 *  5. Una por orden.
 */
export function reviewEligibilityError(input: ReviewEligibilityInput): AuthError | null {
  const { order } = input;

  if (order.buyerId !== input.raterId) return errors.notOrderBuyer();
  if (order.sellerUserId === input.raterId) return errors.selfReviewForbidden();
  if (order.status !== 'COMPLETED') return errors.orderNotCompleted(order.status);
  if (!isWithinReviewWindow(order.completedAt, input.windowDays, input.now)) {
    return errors.reviewWindowClosed(input.windowDays);
  }
  if (input.alreadyReviewed) return errors.reviewAlreadyExists();

  return null;
}
