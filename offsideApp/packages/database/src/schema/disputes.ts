import {
  bigint,
  char,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { disputeReason, disputeResolution, disputeStatus, evidenceUploader } from './_enums';
import { users } from './auth';
import { orders } from './orders';
import { sellerProfiles } from './sellers';

/**
 * Modulo DISPUTES — ERD v1.0 §14.
 * Tablas: disputes, dispute_evidences, dispute_actions.
 *
 * ⚠️ Ciclo de vida PROPIO e independiente del de la Order (DEC-034): una
 * disputa no cambia el estado de la orden. Se relacionan por referencia.
 */

/**
 * ERD §14.1 — disputa. 1 disputa por orden (ERD §20.11).
 * 🟦 Plazos y resolucion por defecto estan PENDING (DEC-009).
 */
export const disputes = pgTable(
  'disputes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'restrict' }),
    buyerId: uuid('buyer_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    sellerId: uuid('seller_id')
      .notNull()
      .references(() => sellerProfiles.id, { onDelete: 'restrict' }),
    reason: disputeReason('reason').notNull(),
    /** OPEN → WAITING_SELLER → UNDER_REVIEW → RESOLVED (DEC-009). */
    status: disputeStatus('status').notNull().default('OPEN'),
    /** Null mientras no este resuelta. */
    resolution: disputeResolution('resolution'),
    refundedAmount: bigint('refunded_amount', { mode: 'bigint' }),
    currency: char('currency', { length: 3 }).notNull().default('ARS'),
    openedAt: timestamp('opened_at', { withTimezone: true }),
    /** 🟦 El PLAZO de respuesta del vendedor esta PENDING (DEC-009). ⚙️ Config Store. */
    sellerResponseDueAt: timestamp('seller_response_due_at', { withTimezone: true }),
    sellerRespondedAt: timestamp('seller_responded_at', { withTimezone: true }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('disputes_order_id_key').on(t.orderId),
    index('disputes_status_idx').on(t.status),
    index('disputes_seller_id_idx').on(t.sellerId),
    index('disputes_buyer_id_idx').on(t.buyerId),
  ],
);

/** ERD §14.2 — evidencias. INMUTABLES (TS-061): no se editan ni se borran. */
export const disputeEvidences = pgTable(
  'dispute_evidences',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    disputeId: uuid('dispute_id')
      .notNull()
      .references(() => disputes.id, { onDelete: 'cascade' }),
    uploadedBy: evidenceUploader('uploaded_by').notNull(),
    uploaderId: uuid('uploader_id').references(() => users.id, { onDelete: 'restrict' }),
    type: text('type'),
    storageKey: text('storage_key'),
    url: text('url'),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('dispute_evidences_dispute_id_idx').on(t.disputeId)],
);

/**
 * ERD §14.3 — efectos de la resolucion. Son COMBINABLES: una resolucion puede
 * producir varias acciones, por eso es una tabla y no una columna.
 */
export const disputeActions = pgTable(
  'dispute_actions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    disputeId: uuid('dispute_id')
      .notNull()
      .references(() => disputes.id, { onDelete: 'cascade' }),
    action: disputeResolution('action').notNull(),
    amount: bigint('amount', { mode: 'bigint' }),
    currency: char('currency', { length: 3 }).notNull().default('ARS'),
    decidedBy: uuid('decided_by').references(() => users.id, { onDelete: 'restrict' }),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('dispute_actions_dispute_id_idx').on(t.disputeId)],
);
