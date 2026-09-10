import {
  bigint,
  char,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { shipmentStatus } from './_enums';
import { orders } from './orders';

/**
 * Modulo SHIPMENTS — ERD v1.0 §13.
 * Tablas: shipments, shipment_tracking_events.
 *
 * 🌐 Correo Argentino. El envio se crea desde la orden en `PROCESSING`
 * (DEC-029). Los estados CRUDOS del proveedor van en `provider_status` (text);
 * `status` es el estado normalizado de Offside.
 */

/** ERD §13.1 — 1 envio por orden (ERD §20.11). */
export const shipments = pgTable(
  'shipments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'restrict' }),
    provider: text('provider'),
    status: shipmentStatus('status').notNull().default('created'),
    trackingNumber: text('tracking_number'),
    labelRef: text('label_ref'),
    /** SNAPSHOT de origen y destino, no FK (ERD §20.2). */
    origin: jsonb('origin'),
    destination: jsonb('destination'),
    packageInfo: jsonb('package_info'),
    costAmount: bigint('cost_amount', { mode: 'bigint' }),
    currency: char('currency', { length: 3 }).notNull().default('ARS'),
    raw: jsonb('raw'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    dispatchedAt: timestamp('dispatched_at', { withTimezone: true }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('shipments_order_id_key').on(t.orderId),
    index('shipments_status_idx').on(t.status),
    index('shipments_tracking_number_idx').on(t.trackingNumber),
  ],
);

/** ERD §13.2 — eventos de tracking. Sirven como evidencia en disputas (SH-002). */
export const shipmentTrackingEvents = pgTable(
  'shipment_tracking_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    shipmentId: uuid('shipment_id')
      .notNull()
      .references(() => shipments.id, { onDelete: 'cascade' }),
    /** Estado normalizado de Offside. */
    status: shipmentStatus('status').notNull(),
    /** 🌐 Estado crudo del proveedor, conservado tal cual. */
    providerStatus: text('provider_status'),
    description: text('description'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }),
    raw: jsonb('raw'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('shipment_tracking_events_shipment_id_idx').on(t.shipmentId),
    index('shipment_tracking_events_occurred_at_idx').on(t.occurredAt),
  ],
);
