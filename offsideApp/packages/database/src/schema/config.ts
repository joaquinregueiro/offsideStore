import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { configScope } from './_enums';
import { users } from './auth';

/**
 * Modulo CONFIG — ERD v1.0 §17. Config Store, opcion C (DEC-038/DEC-039).
 *
 * El Config Store son DOS piezas, no una:
 *   - `app_settings` (esta tabla): key-value ACOTADO y TIPADO para parametros
 *     simples.
 *   - `seller_tiers` (modulo sellers): lo relacional/rico, en tabla de dominio.
 *
 * ⚠️ NO convertir esto en un EAV generico: la opcion C fue la aprobada.
 *
 * ⚠️ REGLA FIRME (DEC-030/038): los valores economicos usados en una operacion
 * se SNAPSHOTEAN en la transaccion (`orders.commission_rate_at_transaction`,
 * etc.). `app_settings` NUNCA se consulta para recalcular lo historico.
 *
 * 🟦 Los VALORES concretos (comision, ventanas, limites, umbrales) estan
 * PENDING y no se seedean desde el codigo. La precedencia
 * (publicacion > categoria > seller_tier > global) se resuelve en la app y su
 * orden fino tambien es 🟦.
 */
export const appSettings = pgTable(
  'app_settings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    scope: configScope('scope').notNull().default('global'),
    /**
     * FK LOGICA a `seller_tiers.id` o `categories.id` segun `scope`.
     * El ERD la define como FK logica (sin constraint) porque la tabla destino
     * depende del valor de `scope`: PostgreSQL no admite una FK polimorfica.
     * La integridad se valida en la app.
     */
    scopeId: uuid('scope_id'),
    /** Ej. 'commission_rate_default', 'payment_window_minutes', 'max_images'. */
    key: text('key').notNull(),
    /** Valor tipado. */
    value: jsonb('value').notNull(),
    /** 'money' | 'int' | 'bool' | 'duration' | 'rate'. Validado en app, es `text` en el ERD. */
    valueType: text('value_type').notNull(),
    /** Se incrementa en cada cambio: el historial de configuracion se conserva. */
    version: integer('version').notNull().default(1),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('app_settings_scope_key_version_key').on(t.scope, t.scopeId, t.key, t.version),
    /** Lookup de la ultima version vigente. */
    index('app_settings_scope_key_idx').on(t.scope, t.scopeId, t.key),
  ],
);
