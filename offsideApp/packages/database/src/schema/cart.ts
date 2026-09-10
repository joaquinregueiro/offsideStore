import {
  bigint,
  char,
  index,
  integer,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { users } from './auth';
import { listings } from './listings';

/**
 * Modulo CART / FAVORITES — ERD v1.0 §10.
 * Tablas: carts, cart_items, favorites.
 *
 * ⚠️ El carrito NO reserva stock (MF-010). El stock se descuenta atomicamente
 * con el pago.
 */

export const carts = pgTable(
  'carts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('carts_user_id_key').on(t.userId)],
);

export const cartItems = pgTable(
  'cart_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    cartId: uuid('cart_id')
      .notNull()
      .references(() => carts.id, { onDelete: 'cascade' }),
    listingId: uuid('listing_id')
      .notNull()
      .references(() => listings.id, { onDelete: 'restrict' }),
    quantity: integer('quantity').notNull().default(1),
    /**
     * Precio visto al agregar. Es una referencia de UX, NO el precio de la
     * orden: el checkout revalida precio y stock (marketplace-flow).
     */
    unitPriceSnapshot: bigint('unit_price_snapshot', { mode: 'bigint' }).notNull(),
    currency: char('currency', { length: 3 }).notNull().default('ARS'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('cart_items_cart_id_listing_id_key').on(t.cartId, t.listingId),
    index('cart_items_cart_id_idx').on(t.cartId),
    index('cart_items_listing_id_idx').on(t.listingId),
  ],
);

export const favorites = pgTable(
  'favorites',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    listingId: uuid('listing_id')
      .notNull()
      .references(() => listings.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('favorites_user_id_listing_id_key').on(t.userId, t.listingId),
    index('favorites_user_id_idx').on(t.userId),
    index('favorites_listing_id_idx').on(t.listingId),
  ],
);
