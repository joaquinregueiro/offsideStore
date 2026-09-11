import { getDatabase, type Database } from '@offside/database';

import { CAPABILITIES, hasCapability } from '@/lib/permissions';

import type { PublicUser } from '../../auth/services/auth.service';
import * as orderEmails from '../../notifications/services/order-emails.service';
import * as reputationService from '../../reputation/services/reputation.service';
import * as reviewRepo from '../repositories/review.repository';
import * as errors from '../reviews.errors';
import {
  normalizeComment,
  normalizeReply,
  RATING_MAX,
  RATING_MIN,
  reviewEligibilityError,
  validateRating,
} from './review-rules';
import { areReviewsEnabled, getReviewWindowDays } from './review-settings.service';

/**
 * CALIFICACIONES (BS-100 / BS-101 / SS-021 / ERD §15).
 *
 * La reseña es UNIDIRECCIONAL: el comprador califica al vendedor y `rating`
 * es suyo. El vendedor puede responder UNA vez (`seller_reply`), como
 * descargo publico; responder no cambia la nota ni entra en la reputacion.
 *
 * ⚠️ MF-041 dice "comprador y vendedor pueden calificarse". El ERD §15 y el
 * esquema modelan una sola direccion (`rater_id` = comprador, sin reseña al
 * comprador). Manda el ERD; la contradiccion queda reportada, no resuelta
 * desde aca.
 *
 * ⚠️ BR-051: la reseña ALIMENTA la reputacion (`onReviewCreated` emite el
 * hecho `REVIEW_RECEIVED` y recomputa) dentro de la MISMA transaccion. Una
 * reseña sin hecho —o un hecho sin reseña— dejaria la reputacion contando
 * algo que no existe.
 *
 * Cada funcion verifica ownership por su cuenta: son alcanzables por Server
 * Action sin pasar por la pantalla.
 */

export type { ReviewRow } from '../repositories/review.repository';
export { COMMENT_MAX_LENGTH, REPLY_MAX_LENGTH } from './review-rules';

/** Reseñas por pagina en el perfil publico del vendedor. */
export const REVIEWS_PAGE_SIZE = 20;

export interface PublicReview {
  id: string;
  orderId: string;
  sellerId: string;
  rating: number;
  comment: string | null;
  sellerReply: string | null;
  sellerRepliedAt: Date | null;
  createdAt: Date;
}

function toPublicReview(row: reviewRepo.ReviewRow): PublicReview {
  return {
    id: row.id,
    orderId: row.orderId,
    sellerId: row.sellerId,
    rating: row.rating,
    comment: row.comment,
    sellerReply: row.sellerReply,
    sellerRepliedAt: row.sellerRepliedAt,
    createdAt: row.createdAt,
  };
}

/** Codigo de PostgreSQL para violacion de UNIQUE: la carrera de "una por orden". */
const UNIQUE_VIOLATION = '23505';

function esViolacionDeUnique(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === UNIQUE_VIOLATION
  );
}

/* -------------------------------------------------------------------------- */
/* Crear                                                                       */
/* -------------------------------------------------------------------------- */

export interface CreateReviewInput {
  orderId: string;
  /** Entero entre `RATING_MIN` y `RATING_MAX`. */
  rating: number;
  comment?: string | null | undefined;
}

/**
 * BS-100: el comprador califica al vendedor de una orden COMPLETED.
 *
 * Reglas, en orden (`review-rules.ts`): feature activa, puntaje valido, solo
 * el comprador, nunca a la propia tienda (BR-051), solo COMPLETED, dentro de
 * `review_window_days`, una por orden. El hecho `REVIEW_RECEIVED` y el
 * recomputo de `seller_reputations` van en la misma transaccion.
 *
 * El email al vendedor (MF-041) se encola DESPUES del commit y no es fatal:
 * una cola caida no puede impedir calificar, y la reseña ya esta guardada.
 */
export async function createReview(
  buyerUser: PublicUser,
  input: CreateReviewInput,
  db?: Database,
): Promise<PublicReview> {
  if (!(await areReviewsEnabled(db))) throw errors.reviewsDisabled();

  const rating = validateRating(input.rating);
  const comment = normalizeComment(input.comment);

  const ejecutar = async (
    tx: Database,
  ): Promise<{ review: PublicReview; orden: reviewRepo.OrderForReview }> => {
    const orden = await reviewRepo.findOrderForReview(input.orderId, tx);
    if (orden === undefined) throw errors.orderNotFound();

    const windowDays = await getReviewWindowDays(tx);
    const existente = await reviewRepo.findByOrderId(input.orderId, tx);

    const rechazo = reviewEligibilityError({
      order: orden,
      raterId: buyerUser.id,
      windowDays,
      now: new Date(),
      alreadyReviewed: existente !== undefined,
    });
    if (rechazo !== null) throw rechazo;

    let fila: reviewRepo.ReviewRow;
    try {
      fila = await reviewRepo.insert(
        { orderId: orden.id, raterId: buyerUser.id, sellerId: orden.sellerId, rating, comment },
        tx,
      );
    } catch (error) {
      // Dos envios del mismo formulario a la vez: el segundo pierde contra
      // UNIQUE(order_id) y recibe el mismo mensaje que si hubiera llegado tarde.
      if (esViolacionDeUnique(error)) throw errors.reviewAlreadyExists();
      throw error;
    }

    await reputationService.onReviewCreated(
      {
        reviewId: fila.id,
        orderId: orden.id,
        sellerId: orden.sellerId,
        sellerUserId: orden.sellerUserId,
        rating,
      },
      tx,
    );

    return { review: toPublicReview(fila), orden };
  };

  const { review, orden } =
    db === undefined ? await getDatabase().transaction(ejecutar) : await ejecutar(db);

  try {
    await orderEmails.calificacionRecibida(
      { email: orden.sellerEmail, nombre: orden.sellerUserDisplayName ?? orden.sellerDisplayName },
      { ordenNumero: orden.orderNumber, puntaje: review.rating, comentario: review.comment },
    );
  } catch (error) {
    // La reseña ya esta confirmada; el aviso es cortesia. Se registra para
    // que no desaparezca en silencio.
    console.error('[reviews] no se pudo encolar el email de calificación recibida', {
      reviewId: review.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return review;
}

/* -------------------------------------------------------------------------- */
/* Lecturas                                                                    */
/* -------------------------------------------------------------------------- */

export interface SellerReviewsPage {
  items: reviewRepo.SellerReviewListItem[];
  total: number;
  pagina: number;
  totalPaginas: number;
}

/** Perfil publico del vendedor (SS-021). `pagina` empieza en 1. */
export async function listSellerReviews(
  sellerId: string,
  pagina = 1,
  db?: Database,
): Promise<SellerReviewsPage> {
  const paginaValida = Number.isInteger(pagina) && pagina >= 1 ? pagina : 1;
  const offset = (paginaValida - 1) * REVIEWS_PAGE_SIZE;

  const [items, total] = await Promise.all([
    reviewRepo.listBySellerId(sellerId, REVIEWS_PAGE_SIZE, offset, db),
    reviewRepo.countBySellerId(sellerId, db),
  ]);

  return {
    items,
    total,
    pagina: paginaValida,
    totalPaginas: Math.max(1, Math.ceil(total / REVIEWS_PAGE_SIZE)),
  };
}

/** La reseña de una orden, o `null`. Para "Mis compras": saber si ya calificaste. */
export async function getReviewForOrder(
  orderId: string,
  db?: Database,
): Promise<PublicReview | null> {
  const fila = await reviewRepo.findByOrderId(orderId, db);

  return fila === undefined ? null : toPublicReview(fila);
}

export type RatingDistribution = Record<1 | 2 | 3 | 4 | 5, number>;

export interface ReviewSummary {
  sellerId: string;
  /** Promedio con dos decimales, o `null` sin reseñas. */
  ratingAvg: number | null;
  total: number;
  distribution: RatingDistribution;
}

/** Promedio, total y distribucion 1..5 (siempre las cinco claves, con cero). */
export async function getReviewSummary(sellerId: string, db?: Database): Promise<ReviewSummary> {
  const filas = await reviewRepo.distributionBySellerId(sellerId, db);

  const distribution: RatingDistribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let total = 0;
  let suma = 0;

  for (const fila of filas) {
    if (fila.rating < RATING_MIN || fila.rating > RATING_MAX) continue;
    distribution[fila.rating as keyof RatingDistribution] = fila.total;
    total += fila.total;
    suma += fila.rating * fila.total;
  }

  return {
    sellerId,
    ratingAvg: total === 0 ? null : Math.round((suma / total) * 100) / 100,
    total,
    distribution,
  };
}

/** Las reseñas que dejo el usuario, con la orden y la tienda. */
export async function listMyReviews(
  buyerUser: PublicUser,
  db?: Database,
): Promise<reviewRepo.MyReviewListItem[]> {
  return reviewRepo.listByRaterId(buyerUser.id, db);
}

/* -------------------------------------------------------------------------- */
/* Responder                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * El vendedor calificado responde UNA vez. No emite hechos ni recomputa:
 * responder no cambia la nota (`reviews.ts`, comentario de la columna).
 */
export async function replyToReview(
  sellerUser: PublicUser,
  reviewId: string,
  texto: string,
  db?: Database,
): Promise<PublicReview> {
  const respuesta = normalizeReply(texto);

  const ejecutar = async (tx: Database): Promise<PublicReview> => {
    const fila = await reviewRepo.findByIdWithSellerUser(reviewId, tx);
    if (fila === undefined) throw errors.reviewNotFound();
    if (fila.sellerUserId !== sellerUser.id) throw errors.notReviewedSeller();
    if (fila.sellerReply !== null) throw errors.replyAlreadyExists();

    const actualizada = await reviewRepo.setSellerReply(reviewId, respuesta, new Date(), tx);
    // El UPDATE condicionado perdio contra otra respuesta simultanea.
    if (actualizada === undefined) throw errors.replyAlreadyExists();

    return toPublicReview(actualizada);
  };

  return db === undefined ? getDatabase().transaction(ejecutar) : ejecutar(db);
}

/* -------------------------------------------------------------------------- */
/* Moderacion                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Ocultar una reseña por moderacion.
 *
 * ⚠️ NO IMPLEMENTADO A PROPOSITO: `reviews` no tiene `hidden_at`,
 * `hidden_by` ni `hidden_reason`, y usar `audit_log` como filtro de lo que
 * se muestra seria convertir un registro append-only de decisiones en
 * estado de negocio. Agregar las columnas es un cambio de ERD (CLAUDE.md
 * §5) que no se decide desde aca. Se verifica la capacidad primero para que
 * el 403 de quien no puede moderar no dependa de que exista la migracion.
 */
export function hideReview(adminUser: PublicUser, reviewId: string, motivo: string): never {
  if (!hasCapability(adminUser.adminRole, CAPABILITIES.TRUST_MODERATE)) {
    throw errors.hideForbidden();
  }

  void reviewId;
  void motivo;

  throw new errors.ReviewModerationUnavailableError();
}
