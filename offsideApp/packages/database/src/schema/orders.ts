import { sql } from 'drizzle-orm';
import {
  bigint,
  char,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { actorType, orderStatus } from './_enums';
import { users } from './auth';
import { listings } from './listings';
import { sellerProfiles } from './sellers';

/**
 * Modulo ORDERS — ERD v1.0 §11.
 * Tablas: orders, order_items, order_status_history.
 */

/**
 * ERD §11.1 — la orden. Ciclo LOGISTICO (DEC-029/034) + snapshot financiero
 * INMUTABLE (DEC-030/038).
 *
 * Reglas duras:
 *  - 1 orden = 1 vendedor (DEC-026). Un carrito multi-vendedor se divide.
 *  - `orders` es la FUENTE COMERCIAL; `payment_splits` es la conciliacion con
 *    MP. No confundir (ERD §26.2).
 *  - El snapshot financiero NUNCA se recalcula con la configuracion actual
 *    (CASO 6 y 8). Cambiar la comision o el tier no toca ordenes historicas.
 *  - Un pago rechazado NO cancela la orden (DEC-033): sigue en
 *    `PENDING_PAYMENT` hasta reintento, vencimiento de `payment_deadline`, o
 *    cancelacion explicita.
 *  - Refund y disputa NO son estados de Order (DEC-034).
 */
export const orders = pgTable(
  'orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Legible para el usuario. */
    orderNumber: text('order_number').notNull(),
    buyerId: uuid('buyer_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    sellerId: uuid('seller_id')
      .notNull()
      .references(() => sellerProfiles.id, { onDelete: 'restrict' }),
    status: orderStatus('status').notNull().default('PENDING_PAYMENT'),
    currency: char('currency', { length: 3 }).notNull().default('ARS'),

    // --- Importes (bigint centavos, ERD §1) ---
    productAmount: bigint('product_amount', { mode: 'bigint' }).notNull(),
    /** DEC-017. */
    discountAmount: bigint('discount_amount', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    shippingAmount: bigint('shipping_amount', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    /** Total cobrado al comprador. Es la BASE de la comision (DEC-014). */
    totalAmount: bigint('total_amount', { mode: 'bigint' }).notNull(),

    // --- SNAPSHOT FINANCIERO (DEC-030) — inmutable, nunca recalcular ---
    /** Tasa de Offside efectivamente aplicada. NO se lee de config al consultar. */
    commissionRateAtTransaction: numeric('commission_rate_at_transaction', {
      precision: 6,
      scale: 4,
    }),
    commissionAmount: bigint('commission_amount', { mode: 'bigint' }),
    /** Costo real de MP. 🌐 No se hardcodea (DEC-030). */
    mpFeeAmount: bigint('mp_fee_amount', { mode: 'bigint' }),
    /** Neto que le corresponde al vendedor. */
    sellerAmount: bigint('seller_amount', { mode: 'bigint' }),
    /** Neto de Offside (comision menos el costo de MP absorbido). */
    offsideAmount: bigint('offside_amount', { mode: 'bigint' }),
    /** Snapshot del tier del vendedor al momento de la venta (CASO 8). */
    sellerTierCodeAtTransaction: text('seller_tier_code_at_transaction'),

    /** SNAPSHOT de la direccion, no FK: editar la libreta no altera la orden. */
    shippingAddress: jsonb('shipping_address').notNull(),
    /**
     * Vencimiento de la ventana de pago (DEC-033).
     * ⚙️ El PLAZO sale del Config Store; aca solo se guarda el instante ya
     * calculado. Nunca hardcodear la ventana.
     */
    paymentDeadline: timestamp('payment_deadline', { withTimezone: true }),
    buyerNote: text('buyer_note'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    shippedAt: timestamp('shipped_at', { withTimezone: true }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('orders_order_number_key').on(t.orderNumber),
    index('orders_buyer_id_created_at_idx').on(t.buyerId, t.createdAt),
    index('orders_seller_id_status_idx').on(t.sellerId, t.status),
    index('orders_status_idx').on(t.status),
    /** Para el job que expira ventanas de pago. */
    index('orders_status_payment_deadline_idx').on(t.status, t.paymentDeadline),
    check(
      'orders_total_amount_check',
      sql`${t.totalAmount} = ${t.productAmount} - ${t.discountAmount} + ${t.shippingAmount}`,
    ),
    check(
      'orders_amounts_non_negative_check',
      sql`${t.productAmount} >= 0 AND ${t.discountAmount} >= 0 AND ${t.shippingAmount} >= 0 AND ${t.totalAmount} >= 0`,
    ),
  ],
);

/** ERD §11.2 — snapshot INMUTABLE de lo comprado (ERD §20.2). */
export const orderItems = pgTable(
  'order_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    /** RESTRICT: no se borra una publicacion vendida. */
    listingId: uuid('listing_id')
      .notNull()
      .references(() => listings.id, { onDelete: 'restrict' }),
    titleSnapshot: text('title_snapshot').notNull(),
    attributesSnapshot: jsonb('attributes_snapshot'),
    unitPriceAmount: bigint('unit_price_amount', { mode: 'bigint' }).notNull(),
    currency: char('currency', { length: 3 }).notNull().default('ARS'),
    quantity: integer('quantity').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('order_items_order_id_idx').on(t.orderId),
    index('order_items_listing_id_idx').on(t.listingId),
  ],
);

/** ERD §11.3 — transiciones de estado de la orden (junto con `audit_log`). */
export const orderStatusHistory = pgTable(
  'order_status_history',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    fromStatus: orderStatus('from_status'),
    toStatus: orderStatus('to_status').notNull(),
    actorType: actorType('actor_type').notNull(),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'restrict' }),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('order_status_history_order_id_idx').on(t.orderId)],
);
