import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { users } from './auth';
import { orders } from './orders';
import { sellerProfiles } from './sellers';

/**
 * Modulo REVIEWS — ERD v1.0 §15.
 *
 * 1 review por orden (ERD §20.11). Solo sobre ordenes `COMPLETED` (o
 * `DELIVERED` segun politica) — validado en app, no por constraint.
 * Al crearse emite un `user_history_events` (REVIEW_RECEIVED) para el vendedor.
 */
export const reviews = pgTable(
  'reviews',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'restrict' }),
    /** Quien califica (el comprador). */
    raterId: uuid('rater_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    sellerId: uuid('seller_id')
      .notNull()
      .references(() => sellerProfiles.id, { onDelete: 'restrict' }),
    rating: integer('rating').notNull(),
    comment: text('comment'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('reviews_order_id_key').on(t.orderId),
    index('reviews_seller_id_idx').on(t.sellerId),
    check('reviews_rating_check', sql`${t.rating} >= 1 AND ${t.rating} <= 5`),
  ],
);
