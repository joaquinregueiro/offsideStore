import { boolean, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { actorType, historyEventType, identityStatus, riskLevel, userLevel } from './_enums';
import { users } from './auth';
import { countries } from './catalog';

/**
 * Modulo USERS — ERD v1.0 §6.
 * Tablas: user_addresses, identity_verifications, user_history_events,
 * user_level_history, user_risk_history.
 */

/**
 * ERD §6.1 — libreta de direcciones del usuario.
 *
 * ⚠️ En `orders`/`shipments` la direccion se guarda como SNAPSHOT jsonb, NO como
 * FK a esta tabla: editar una direccion no debe alterar una orden historica
 * (ERD §20.2).
 */
export const userAddresses = pgTable(
  'user_addresses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    label: text('label'),
    recipientName: text('recipient_name').notNull(),
    phone: text('phone'),
    street: text('street').notNull(),
    number: text('number'),
    apartment: text('apartment'),
    city: text('city').notNull(),
    province: text('province').notNull(),
    /** Clave para cotizar envio con Correo Argentino. */
    postalCode: text('postal_code').notNull(),
    countryId: uuid('country_id')
      .notNull()
      .references(() => countries.id, { onDelete: 'restrict' }),
    isDefault: boolean('is_default').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('user_addresses_user_id_idx').on(t.userId)],
);

/**
 * ERD §6.2 — verificacion de identidad propia de Offside.
 * Independiente del KYC de Mercado Pago (TS-001). 🟦 el `method` esta PENDING.
 */
export const identityVerifications = pgTable(
  'identity_verifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    status: identityStatus('status').notNull().default('unverified'),
    /** 🟦 PENDING: el metodo de verificacion no esta definido (TS-001). */
    method: text('method'),
    data: jsonb('data'),
    reviewedBy: uuid('reviewed_by').references(() => users.id, { onDelete: 'restrict' }),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('identity_verifications_user_id_idx').on(t.userId),
    index('identity_verifications_status_idx').on(t.status),
  ],
);

/**
 * ERD §6.3 — FUENTE DE VERDAD DE LA CONFIANZA (DEC-036/040).
 *
 * Log APPEND-ONLY de HECHOS OBJETIVOS ("¿que paso?"). Reglas duras:
 *
 *  - INMUTABLE: nunca update ni delete. Los hechos no desaparecen.
 *  - SOLO HECHOS: nada de `HIGH_RISK`/`FRAUD`. Las interpretaciones de riesgo
 *    van en `risk_events` (§16.1). No mezclar responsabilidades (DEC-040).
 *  - `users.user_level`, `users.risk_level` y `seller_reputations` se DERIVAN
 *    de esta tabla; ninguno es autoridad por si mismo.
 *
 * FK con RESTRICT: borrar un usuario no puede borrar su historial.
 * 🟦 La formula de nivel/riesgo (DEC-020/021) esta PENDING; la estructura
 * soporta cualquier formula.
 */
export const userHistoryEvents = pgTable(
  'user_history_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Sujeto del hecho. RESTRICT: el historial sobrevive al usuario. */
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    eventType: historyEventType('event_type').notNull(),
    /** 'buyer' / 'seller' segun el rol en el hecho. */
    role: text('role'),
    /** 'order' / 'dispute' / 'refund' / 'review' / ... */
    refEntityType: text('ref_entity_type'),
    refEntityId: uuid('ref_entity_id'),
    /** Payload del hecho (montos, motivo, ...). */
    data: jsonb('data'),
    /** Momento del hecho. */
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('user_history_events_user_id_created_at_idx').on(t.userId, t.createdAt),
    index('user_history_events_event_type_idx').on(t.eventType),
    index('user_history_events_ref_entity_idx').on(t.refEntityType, t.refEntityId),
  ],
);

/** ERD §6.4 — auditoria de transiciones de `users.user_level` (DEC-020). */
export const userLevelHistory = pgTable(
  'user_level_history',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    fromValue: userLevel('from_value'),
    toValue: userLevel('to_value').notNull(),
    reason: text('reason'),
    /** system = automatico, admin = manual. */
    triggeredBy: actorType('triggered_by').notNull(),
    /** Null si el cambio fue automatico. */
    adminId: uuid('admin_id').references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('user_level_history_user_id_created_at_idx').on(t.userId, t.createdAt)],
);

/**
 * ERD §6.5 — auditoria de transiciones de `users.risk_level` (DEC-021).
 * Reemplaza al viejo `seller_risk_history`: el riesgo es del USUARIO.
 */
export const userRiskHistory = pgTable(
  'user_risk_history',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    fromValue: riskLevel('from_value'),
    toValue: riskLevel('to_value').notNull(),
    reason: text('reason'),
    triggeredBy: actorType('triggered_by').notNull(),
    adminId: uuid('admin_id').references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('user_risk_history_user_id_created_at_idx').on(t.userId, t.createdAt)],
);
