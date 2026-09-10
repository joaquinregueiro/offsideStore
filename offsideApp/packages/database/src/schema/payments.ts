import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  char,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { paymentStatus, refundStatus, refundType, sellerLiabilityStatus } from './_enums';
import { users } from './auth';
import { disputes } from './disputes';
import { orders } from './orders';
import { sellerProfiles } from './sellers';

/**
 * Modulo PAYMENTS — ERD v1.0 §12.
 * Tablas: payments, payment_splits, payment_webhook_events, refunds,
 * chargebacks, seller_liabilities, reconciliation_records.
 *
 * 🌐 Todo este modulo depende de Mercado Pago. Reglas transversales:
 *  - Los WEBHOOKS son la fuente de verdad, no el redirect del frontend (PC-040).
 *  - Toda operacion debe ser IDEMPOTENTE: los webhooks se reintentan y llegan
 *    desordenados.
 *  - Se conserva el estado CRUDO de MP (`mp_status`/`raw`) ademas del
 *    normalizado (DEC-035).
 *  - La tasa de MP NO se hardcodea (DEC-030).
 */

/** ERD §12.1 — pago. */
export const payments = pgTable(
  'payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'restrict' }),
    /**
     * ID de la PREFERENCIA de Checkout Pro.
     *
     * Existe ANTES que `mp_payment_id`: la preferencia se crea al iniciar el
     * checkout y el pago recien existe cuando el comprador paga. Es el unico
     * identificador que Offside tiene en esa ventana, y sin el no se puede
     * reconciliar un checkout abandonado ni reintentar de forma idempotente.
     * UNIQUE parcial (solo cuando no es null).
     */
    mpPreferenceId: text('mp_preference_id'),
    /** ID del pago en MP. UNIQUE parcial (solo cuando no es null). */
    mpPaymentId: text('mp_payment_id'),
    /** Estado NORMALIZADO de Offside (DEC-028/035). */
    status: paymentStatus('status').notNull().default('PENDING'),
    /** Estado ORIGINAL de MP, conservado tal cual (DEC-035). Es `text`, no enum. */
    mpStatus: text('mp_status'),
    mpStatusDetail: text('mp_status_detail'),
    /** Idempotencia al crear el pago. 🌐 a confirmar contra doc oficial de MP. */
    idempotencyKey: text('idempotency_key'),
    /** 🌐 */
    paymentMethod: text('payment_method'),
    /** Cuotas (DEC-016). */
    installments: integer('installments'),
    amount: bigint('amount', { mode: 'bigint' }).notNull(),
    currency: char('currency', { length: 3 }).notNull().default('ARS'),
    /** 'pro' — Checkout Pro (DEC-027). */
    checkoutType: text('checkout_type').notNull(),
    /** Payload crudo de MP. Se conserva siempre (DEC-035). */
    raw: jsonb('raw'),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }),
  },
  (t) => [
    index('payments_order_id_idx').on(t.orderId),
    uniqueIndex('payments_mp_preference_id_key')
      .on(t.mpPreferenceId)
      .where(sql`${t.mpPreferenceId} IS NOT NULL`),
    uniqueIndex('payments_mp_payment_id_key')
      .on(t.mpPaymentId)
      .where(sql`${t.mpPaymentId} IS NOT NULL`),
    uniqueIndex('payments_idempotency_key_key')
      .on(t.idempotencyKey)
      .where(sql`${t.idempotencyKey} IS NOT NULL`),
    index('payments_status_idx').on(t.status),
  ],
);

/**
 * ERD §12.2 — conciliacion del reparto REAL informado por MP.
 *
 * ⚠️ No confundir con el snapshot de `orders`: `orders` es la fuente comercial,
 * `payment_splits` es lo que MP efectivamente repartio (ERD §26.2).
 */
export const paymentSplits = pgTable(
  'payment_splits',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    paymentId: uuid('payment_id')
      .notNull()
      .references(() => payments.id, { onDelete: 'cascade' }),
    sellerAmount: bigint('seller_amount', { mode: 'bigint' }).notNull(),
    marketplaceFeeAmount: bigint('marketplace_fee_amount', { mode: 'bigint' }).notNull(),
    /** 🌐 Costo real informado por MP. */
    mpFeeAmount: bigint('mp_fee_amount', { mode: 'bigint' }),
    currency: char('currency', { length: 3 }).notNull().default('ARS'),
    raw: jsonb('raw'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('payment_splits_payment_id_idx').on(t.paymentId)],
);

/**
 * ERD §12.3 — log IDEMPOTENTE de webhooks (PC-041).
 * `idempotency_key` UNIQUE es lo que impide procesar dos veces el mismo evento.
 */
export const paymentWebhookEvents = pgTable(
  'payment_webhook_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    provider: text('provider').notNull(),
    eventType: text('event_type').notNull(),
    resourceId: text('resource_id'),
    idempotencyKey: text('idempotency_key').notNull(),
    signatureValid: boolean('signature_valid'),
    payload: jsonb('payload'),
    processed: boolean('processed').notNull().default(false),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    error: text('error'),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('payment_webhook_events_idempotency_key_key').on(t.idempotencyKey),
    index('payment_webhook_events_resource_id_idx').on(t.resourceId),
    index('payment_webhook_events_processed_idx').on(t.processed),
  ],
);

/**
 * ERD §12.4 — reembolsos.
 * 🟦 Las reglas de reversa, costos y plazos estan PENDING (DEC-008/031): aca
 * solo se modela la ESTRUCTURA. Si la parte del vendedor no se recupera, se
 * genera un registro en `seller_liabilities`.
 */
export const refunds = pgTable(
  'refunds',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'restrict' }),
    paymentId: uuid('payment_id')
      .notNull()
      .references(() => payments.id, { onDelete: 'restrict' }),
    disputeId: uuid('dispute_id').references(() => disputes.id, { onDelete: 'restrict' }),
    type: refundType('type').notNull(),
    status: refundStatus('status').notNull().default('REQUESTED'),
    /** Reembolsado al comprador. */
    amount: bigint('amount', { mode: 'bigint' }).notNull(),
    currency: char('currency', { length: 3 }).notNull().default('ARS'),
    /** 🌐 Parte proporcional del vendedor. */
    sellerPortionAmount: bigint('seller_portion_amount', { mode: 'bigint' }),
    /** Comision revertida por Offside (DEC-018). */
    marketplacePortionAmount: bigint('marketplace_portion_amount', { mode: 'bigint' }),
    sellerPortionRecovered: boolean('seller_portion_recovered').notNull().default(false),
    mpRefundId: text('mp_refund_id'),
    /** 🟦 Los motivos concretos estan PENDING (DEC-031). */
    reason: text('reason'),
    raw: jsonb('raw'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
  },
  (t) => [
    index('refunds_order_id_idx').on(t.orderId),
    index('refunds_payment_id_idx').on(t.paymentId),
    index('refunds_status_idx').on(t.status),
  ],
);

/** ERD §12.5 — contracargos. `status` es `text` porque el estado es crudo de MP 🌐. */
export const chargebacks = pgTable(
  'chargebacks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'restrict' }),
    paymentId: uuid('payment_id')
      .notNull()
      .references(() => payments.id, { onDelete: 'restrict' }),
    mpChargebackId: text('mp_chargeback_id'),
    /** 🌐 Estado crudo de MP; por eso `text` y no enum. */
    status: text('status'),
    amount: bigint('amount', { mode: 'bigint' }).notNull(),
    currency: char('currency', { length: 3 }).notNull().default('ARS'),
    evidence: jsonb('evidence'),
    raw: jsonb('raw'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  },
  (t) => [
    index('chargebacks_order_id_idx').on(t.orderId),
    index('chargebacks_payment_id_idx').on(t.paymentId),
  ],
);

/**
 * ERD §12.6 — deuda del vendedor con Offside.
 * 🟦 Las reglas de RECUPERACION estan PENDING (DEC-019): solo se modelan los
 * estados. El motor de recupero/bloqueo/exposicion no se define ahora.
 */
export const sellerLiabilities = pgTable(
  'seller_liabilities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sellerId: uuid('seller_id')
      .notNull()
      .references(() => sellerProfiles.id, { onDelete: 'restrict' }),
    /** Orden que origino la deuda. */
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'restrict' }),
    refundId: uuid('refund_id').references(() => refunds.id, { onDelete: 'restrict' }),
    chargebackId: uuid('chargeback_id').references(() => chargebacks.id, { onDelete: 'restrict' }),
    amount: bigint('amount', { mode: 'bigint' }).notNull(),
    /** Cubierto hasta ahora. Soporta el estado PARTIALLY_SETTLED. */
    settledAmount: bigint('settled_amount', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    currency: char('currency', { length: 3 }).notNull().default('ARS'),
    status: sellerLiabilityStatus('status').notNull().default('OPEN'),
    reason: text('reason'),
    /** Decision administrativa, auditada. */
    adminDecision: jsonb('admin_decision'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  },
  (t) => [
    index('seller_liabilities_seller_id_idx').on(t.sellerId),
    index('seller_liabilities_order_id_idx').on(t.orderId),
    index('seller_liabilities_status_idx').on(t.status),
    check(
      'seller_liabilities_settled_amount_check',
      sql`${t.settledAmount} >= 0 AND ${t.settledAmount} <= ${t.amount}`,
    ),
  ],
);

/** ERD §12.7 — conciliacion periodica contra MP. 🌐 `source` a definir. */
export const reconciliationRecords = pgTable('reconciliation_records', {
  id: uuid('id').primaryKey().defaultRandom(),
  periodStart: date('period_start').notNull(),
  periodEnd: date('period_end').notNull(),
  /** 🌐 Origen del reporte conciliado. */
  source: text('source'),
  summary: jsonb('summary'),
  discrepancies: jsonb('discrepancies'),
  /** 'open' / 'closed'. Es `text` en el ERD, no enum. */
  status: text('status'),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'restrict' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
