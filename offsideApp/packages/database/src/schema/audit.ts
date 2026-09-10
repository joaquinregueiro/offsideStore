import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { actorType } from './_enums';
import { users } from './auth';

/**
 * Modulo AUDIT — ERD v1.0 §19.1.
 *
 * ⚠️ APPEND-ONLY: nunca update ni delete.
 *
 * Es OBLIGATORIO escribir aca ante: movimientos de dinero, sanciones, disputas,
 * credenciales de Mercado Pago, cambios de `user_level`/`risk_level`/`status`/
 * `admin_role`/`seller_tier_id`, y cambios de CONFIGURACION.
 *
 * Es transversal: no tiene FK obligatoria al nucleo (ERD §4). `entity_type` y
 * `entity_id` son una referencia polimorfica deliberada, sin constraint.
 */
export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actorType: actorType('actor_type').notNull(),
    /** Null si el actor es el sistema. */
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'restrict' }),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id'),
    before: jsonb('before'),
    after: jsonb('after'),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('audit_log_entity_idx').on(t.entityType, t.entityId),
    index('audit_log_actor_id_idx').on(t.actorId),
    index('audit_log_action_idx').on(t.action),
    index('audit_log_created_at_idx').on(t.createdAt),
  ],
);
