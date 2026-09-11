import { getDatabase, schema, type Database } from '@offside/database';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';

/**
 * Acceso a `reviews` (ERD §15) y a las lecturas de `orders`, `seller_profiles`
 * y `users` que la calificacion necesita para autorizarse. Sin reglas de
 * negocio.
 *
 * ⚠️ POR QUE ESTE MODULO LEE `orders`: un modulo no importa el Repository de
 * otro (`modules/README.md`) y `orders` no expone un Service para "dame la
 * orden con el usuario del vendedor". Es lectura pura: `orders` sigue siendo
 * el unico que escribe su tabla.
 */

export type ReviewRow = typeof schema.reviews.$inferSelect;

const conn = (db?: Database): Database => db ?? getDatabase();

/* -------------------------------------------------------------------------- */
/* Lecturas de la orden, para autorizar                                        */
/* -------------------------------------------------------------------------- */

export interface OrderForReview {
  id: string;
  orderNumber: string;
  status: (typeof schema.orderStatus.enumValues)[number];
  buyerId: string;
  sellerId: string;
  sellerUserId: string;
  sellerDisplayName: string;
  /** Para el email al vendedor (MF-041). */
  sellerEmail: string;
  sellerUserDisplayName: string | null;
  completedAt: Date | null;
}

export async function findOrderForReview(
  orderId: string,
  db?: Database,
): Promise<OrderForReview | undefined> {
  const [row] = await conn(db)
    .select({
      id: schema.orders.id,
      orderNumber: schema.orders.orderNumber,
      status: schema.orders.status,
      buyerId: schema.orders.buyerId,
      sellerId: schema.orders.sellerId,
      sellerUserId: schema.sellerProfiles.userId,
      sellerDisplayName: schema.sellerProfiles.displayName,
      sellerEmail: schema.users.email,
      sellerUserDisplayName: schema.users.displayName,
      completedAt: schema.orders.completedAt,
    })
    .from(schema.orders)
    .innerJoin(schema.sellerProfiles, eq(schema.orders.sellerId, schema.sellerProfiles.id))
    .innerJoin(schema.users, eq(schema.sellerProfiles.userId, schema.users.id))
    .where(eq(schema.orders.id, orderId))
    .limit(1);

  return row;
}

/* -------------------------------------------------------------------------- */
/* reviews                                                                      */
/* -------------------------------------------------------------------------- */

export async function findByOrderId(
  orderId: string,
  db?: Database,
): Promise<ReviewRow | undefined> {
  const [row] = await conn(db)
    .select()
    .from(schema.reviews)
    .where(eq(schema.reviews.orderId, orderId))
    .limit(1);

  return row;
}

export interface ReviewWithSellerUser extends ReviewRow {
  sellerUserId: string;
}

/** La reseña con el usuario dueño del perfil calificado, para autorizar la respuesta. */
export async function findByIdWithSellerUser(
  reviewId: string,
  db?: Database,
): Promise<ReviewWithSellerUser | undefined> {
  const [row] = await conn(db)
    .select({
      id: schema.reviews.id,
      orderId: schema.reviews.orderId,
      raterId: schema.reviews.raterId,
      sellerId: schema.reviews.sellerId,
      rating: schema.reviews.rating,
      comment: schema.reviews.comment,
      sellerReply: schema.reviews.sellerReply,
      sellerRepliedAt: schema.reviews.sellerRepliedAt,
      createdAt: schema.reviews.createdAt,
      sellerUserId: schema.sellerProfiles.userId,
    })
    .from(schema.reviews)
    .innerJoin(schema.sellerProfiles, eq(schema.reviews.sellerId, schema.sellerProfiles.id))
    .where(eq(schema.reviews.id, reviewId))
    .limit(1);

  return row;
}

export interface ReviewInsert {
  orderId: string;
  raterId: string;
  sellerId: string;
  rating: number;
  comment: string | null;
}

export async function insert(values: ReviewInsert, db?: Database): Promise<ReviewRow> {
  const [row] = await conn(db).insert(schema.reviews).values(values).returning();

  if (row === undefined) throw new Error('reviews: el INSERT no devolvio la fila');

  return row;
}

/**
 * Escribe la respuesta SOLO si todavia no hay una (`seller_reply IS NULL`).
 * Devuelve la fila actualizada, o `undefined` si otra respuesta llego antes:
 * la condicion en el WHERE es lo que vuelve "una sola vez" atomico.
 */
export async function setSellerReply(
  reviewId: string,
  reply: string,
  repliedAt: Date,
  db?: Database,
): Promise<ReviewRow | undefined> {
  const [row] = await conn(db)
    .update(schema.reviews)
    .set({ sellerReply: reply, sellerRepliedAt: repliedAt })
    .where(and(eq(schema.reviews.id, reviewId), isNull(schema.reviews.sellerReply)))
    .returning();

  return row;
}

/* -------------------------------------------------------------------------- */
/* Listados publicos y del comprador                                           */
/* -------------------------------------------------------------------------- */

export interface SellerReviewListItem {
  id: string;
  rating: number;
  comment: string | null;
  sellerReply: string | null;
  sellerRepliedAt: Date | null;
  createdAt: Date;
  /** `users.display_name` de quien califico; null si no lo cargo. */
  raterDisplayName: string | null;
}

export async function listBySellerId(
  sellerId: string,
  limit: number,
  offset: number,
  db?: Database,
): Promise<SellerReviewListItem[]> {
  return (
    conn(db)
      .select({
        id: schema.reviews.id,
        rating: schema.reviews.rating,
        comment: schema.reviews.comment,
        sellerReply: schema.reviews.sellerReply,
        sellerRepliedAt: schema.reviews.sellerRepliedAt,
        createdAt: schema.reviews.createdAt,
        raterDisplayName: schema.users.displayName,
      })
      .from(schema.reviews)
      .innerJoin(schema.users, eq(schema.reviews.raterId, schema.users.id))
      .where(eq(schema.reviews.sellerId, sellerId))
      // Desempate por id: sin el, dos reseñas del mismo instante cambiarian de
      // pagina entre una consulta y la siguiente.
      .orderBy(desc(schema.reviews.createdAt), desc(schema.reviews.id))
      .limit(limit)
      .offset(offset)
  );
}

export async function countBySellerId(sellerId: string, db?: Database): Promise<number> {
  const [row] = await conn(db)
    .select({ total: sql<number>`count(*)::int` })
    .from(schema.reviews)
    .where(eq(schema.reviews.sellerId, sellerId));

  return row?.total ?? 0;
}

export interface RatingDistributionRow {
  rating: number;
  total: number;
}

/** Cantidad de reseñas por puntaje. Los puntajes sin reseñas no vienen. */
export async function distributionBySellerId(
  sellerId: string,
  db?: Database,
): Promise<RatingDistributionRow[]> {
  return conn(db)
    .select({ rating: schema.reviews.rating, total: sql<number>`count(*)::int` })
    .from(schema.reviews)
    .where(eq(schema.reviews.sellerId, sellerId))
    .groupBy(schema.reviews.rating);
}

export interface MyReviewListItem {
  id: string;
  orderId: string;
  orderNumber: string;
  sellerId: string;
  sellerDisplayName: string;
  rating: number;
  comment: string | null;
  sellerReply: string | null;
  sellerRepliedAt: Date | null;
  createdAt: Date;
}

export async function listByRaterId(raterId: string, db?: Database): Promise<MyReviewListItem[]> {
  return conn(db)
    .select({
      id: schema.reviews.id,
      orderId: schema.reviews.orderId,
      orderNumber: schema.orders.orderNumber,
      sellerId: schema.reviews.sellerId,
      sellerDisplayName: schema.sellerProfiles.displayName,
      rating: schema.reviews.rating,
      comment: schema.reviews.comment,
      sellerReply: schema.reviews.sellerReply,
      sellerRepliedAt: schema.reviews.sellerRepliedAt,
      createdAt: schema.reviews.createdAt,
    })
    .from(schema.reviews)
    .innerJoin(schema.orders, eq(schema.reviews.orderId, schema.orders.id))
    .innerJoin(schema.sellerProfiles, eq(schema.reviews.sellerId, schema.sellerProfiles.id))
    .where(eq(schema.reviews.raterId, raterId))
    .orderBy(desc(schema.reviews.createdAt), desc(schema.reviews.id));
}
