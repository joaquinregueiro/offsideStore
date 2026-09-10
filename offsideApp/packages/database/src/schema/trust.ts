import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { riskSeverity, riskSource, riskType, sanctionType } from './_enums';
import { users } from './auth';
import { disputes } from './disputes';
import { sellerProfiles } from './sellers';
import { userHistoryEvents } from './users';

/**
 * Modulo TRUST & SAFETY — ERD v1.0 §16.
 * Tablas: risk_events, sanctions.
 */

/**
 * ERD §16.1 — SEÑALES DE RIESGO (interpretacion) — DEC-040.
 *
 * ⚠️ SEPARACION DE RESPONSABILIDADES (DEC-040), no mezclar:
 *
 *   user_history_events  = HECHOS         ("¿que paso?")        fuente de verdad
 *   risk_events          = INTERPRETACION ("¿que señal vemos?")  derivado
 *   users.risk_level     = ESTADO ACTUAL
 *
 * Esta tabla NUNCA modifica ni reemplaza el historial. Cambiar la logica de
 * riesgo (Risk Engine) no altera los hechos: solo cambia la evaluacion.
 *
 * 🟦 La formula y los umbrales estan PENDING (DEC-020/021). En el MVP las
 * señales se generan por reglas simples y CONFIGURABLES; no hay Risk Engine.
 */
export const riskEvents = pgTable(
  'risk_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Sujeto de la señal. El riesgo es del USUARIO, no del vendedor. */
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    riskType: riskType('risk_type').notNull(),
    severity: riskSeverity('severity').notNull(),
    /** SYSTEM (motor) o ADMIN (manual). */
    source: riskSource('source').notNull(),
    /** Contexto: 'SELLER_PROFILE' / 'ORDER' / 'DISPUTE' / ... */
    referenceType: text('reference_type'),
    referenceId: uuid('reference_id'),
    /**
     * Origen directo si la señal viene de UN hecho concreto.
     * NULLABLE a proposito (DEC-040): una señal puede surgir de MUCHOS hechos,
     * de un patron, o de reglas configuradas / eventos externos. En esos casos
     * es null y el como se calculo va en `metadata`.
     */
    sourceHistoryEventId: uuid('source_history_event_id').references(() => userHistoryEvents.id, {
      onDelete: 'restrict',
    }),
    /** Como se calculo la señal (ej. "20 cancelaciones / 25 ventas"). */
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    /** Cuando dejo de aplicar la señal. */
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  },
  (t) => [
    index('risk_events_user_id_created_at_idx').on(t.userId, t.createdAt),
    index('risk_events_risk_type_idx').on(t.riskType),
    index('risk_events_severity_idx').on(t.severity),
    index('risk_events_source_history_event_id_idx').on(t.sourceHistoryEventId),
  ],
);

/**
 * ERD §16.2 — sanciones. Se aplican al VENDEDOR (capacidad de vender).
 * Toda sancion se registra en `audit_log`.
 */
export const sanctions = pgTable(
  'sanctions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sellerId: uuid('seller_id')
      .notNull()
      .references(() => sellerProfiles.id, { onDelete: 'restrict' }),
    type: sanctionType('type').notNull(),
    reason: text('reason'),
    disputeId: uuid('dispute_id').references(() => disputes.id, { onDelete: 'restrict' }),
    limitations: jsonb('limitations'),
    appliedBy: uuid('applied_by').references(() => users.id, { onDelete: 'restrict' }),
    startsAt: timestamp('starts_at', { withTimezone: true }),
    endsAt: timestamp('ends_at', { withTimezone: true }),
    /** 'active' / 'lifted' / 'expired'. Es `text` en el ERD, no enum. */
    status: text('status'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('sanctions_seller_id_idx').on(t.sellerId),
    index('sanctions_status_idx').on(t.status),
  ],
);
