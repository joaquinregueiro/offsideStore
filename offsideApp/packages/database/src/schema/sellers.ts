import {
  boolean,
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

import { sql } from 'drizzle-orm';

import { mpConnectionStatus, sellerStatus, taxIdType, taxVerificationStatus } from './_enums';
import { users } from './auth';

/**
 * Modulo SELLERS — ERD v1.0 §7.
 * Tablas: seller_tiers, seller_profiles, mercadopago_accounts, seller_reputations.
 */

/**
 * ERD §7.1 — categoria comercial del vendedor (DEC-037).
 *
 * Parte del Config Store (opcion C): lo relacional/rico vive en esta tabla de
 * dominio, no en el key-value de `app_settings`. Es una TABLA y no un enum
 * justamente para poder crear/editar tiers sin migracion.
 *
 * ⚠️ Independiente de `users.user_level` (DEC-037): son conceptos distintos.
 * 🟦 Sus valores concretos (codes, tasas, limites) estan PENDING y NO se
 * seedean desde el codigo (DEC-007/037).
 */
export const sellerTiers = pgTable(
  'seller_tiers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Ej. STANDARD / VERIFIED. 🟦 valores no definidos. */
    code: text('code').notNull(),
    name: text('name').notNull(),
    /**
     * Tasa por defecto del tier. ⚙️ CONFIGURABLE desde Admin — 🟦 sin valor.
     * NUNCA hardcodear una comision aca ni en el codigo (DEC-007/030).
     */
    commissionRate: numeric('commission_rate', { precision: 6, scale: 4 }),
    /** Limites (publicaciones, montos, ...). 🟦 */
    limits: jsonb('limits'),
    /** Beneficios/condiciones. 🟦 */
    benefits: jsonb('benefits'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('seller_tiers_code_key').on(t.code)],
);

/**
 * ERD §7.2 — perfil de vendedor. 1:1 con `users`.
 *
 * ⚠️ NO aloja `user_level` ni `risk_level`: esos viven en `users` (Fase 2 §3).
 * Cambiar `seller_tier_id` NO afecta ordenes historicas, que snapshotean el
 * tier y la comision (CASO 8 / DEC-030).
 */
export const sellerProfiles = pgTable(
  'seller_profiles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    /** Null = sin tier asignado (DEC-037). */
    sellerTierId: uuid('seller_tier_id').references(() => sellerTiers.id, { onDelete: 'restrict' }),
    /** Nombre de tienda. */
    displayName: text('display_name').notNull(),
    bio: text('bio'),
    /** Habilitacion para vender. Pasa a `approved` segun TS-010. */
    status: sellerStatus('status').notNull().default('pending'),
    dispatchLocation: jsonb('dispatch_location'),
    shippingPolicy: text('shipping_policy'),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    /**
     * ⚠️ NO ESTA EN EL ERD v1.3 (segundo delta del 2026-09-10, autorizado por
     * el owner; ver `docs-implementation/erd-delta-2026-09-10.md`).
     *
     * MODO VACACIONES: el vendedor esta ausente MIENTRAS `now() <
     * vacation_until`. Es un PREDICADO DERIVADO, no un estado: no toca
     * `listings.status` ni `seller_profiles.status`, y al vencer no hay nada
     * que reactivar. Es exactamente la misma logica que la desconexion de
     * Mercado Pago (SS-013): si se materializara `paused` en cada publicacion,
     * al volver seria imposible distinguir las que el vendedor pauso a mano
     * (SS-050) de las que apago la ausencia. Null = no esta de vacaciones.
     */
    vacationUntil: timestamp('vacation_until', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('seller_profiles_user_id_key').on(t.userId),
    index('seller_profiles_status_idx').on(t.status),
    index('seller_profiles_seller_tier_id_idx').on(t.sellerTierId),
  ],
);

/**
 * ERD §7.3 — conexion OAuth de COBRO con Mercado Pago (DEC-005).
 *
 * ⚠️ DATOS SENSIBLES: los tokens se guardan CIFRADOS en reposo
 * (`TOKEN_ENCRYPTION_KEY`) y NUNCA se exponen por API (CLAUDE.md §10).
 * Conectar MP no es login ni otorga confianza (BR-003).
 * 🌐 La vida y rotacion de los tokens dependen de MP y estan sin confirmar.
 */
export const mercadopagoAccounts = pgTable(
  'mercadopago_accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sellerId: uuid('seller_id')
      .notNull()
      .references(() => sellerProfiles.id, { onDelete: 'restrict' }),
    mpUserId: text('mp_user_id').notNull(),
    accessTokenEncrypted: text('access_token_encrypted'),
    refreshTokenEncrypted: text('refresh_token_encrypted'),
    tokenExpiresAt: timestamp('token_expires_at', { withTimezone: true }),
    scopes: text('scopes').array(),
    publicKey: text('public_key'),
    /** Si no es `connected`, el vendedor no puede vender (SS-013). */
    status: mpConnectionStatus('status').notNull().default('disconnected'),
    connectedAt: timestamp('connected_at', { withTimezone: true }),
    lastRefreshedAt: timestamp('last_refreshed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('mercadopago_accounts_seller_id_key').on(t.sellerId),
    uniqueIndex('mercadopago_accounts_mp_user_id_key').on(t.mpUserId),
    index('mercadopago_accounts_status_idx').on(t.status),
    index('mercadopago_accounts_token_expires_at_idx').on(t.tokenExpiresAt),
  ],
);

/**
 * Identidad fiscal del vendedor.
 *
 * ⚠️ TABLA NUEVA, **todavia no reflejada en el ERD** (v1.1 no tiene nada
 * fiscal). Ver `docs-implementation/seller-tax-identity.md`.
 *
 * SEPARACION DE RESPONSABILIDADES — no mezclar estas tres cosas:
 *
 *   1. `tax_id_type` + `tax_id`  →  lo que DECLARO el vendedor, ya normalizado.
 *   2. `verification_status`     →  si la FUENTE OFICIAL lo confirmo.
 *   3. `tax_condition`           →  QUE dijo esa fuente.
 *
 * Que el identificador pase la validacion sintactica (formato + digito
 * verificador) NO lo vuelve verificado: eso es (1), no (2).
 *
 * HISTORIAL: la condicion fiscal de una persona CAMBIA con el tiempo, y una
 * liquidacion vieja debe poder explicarse con la condicion que regia entonces.
 * Por eso la tabla es append-only por diseño: se cierra la fila vigente
 * poniendo `valid_to` y se inserta una nueva. El indice unico parcial garantiza
 * que haya **una sola fila vigente por vendedor**.
 *
 * ⚠️ `tax_condition` NO debe usarse para calcular comisiones ni percepciones.
 * La comision de Offside y la fiscalidad son conceptos desacoplados.
 */
export const sellerTaxProfiles = pgTable(
  'seller_tax_profiles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sellerId: uuid('seller_id')
      .notNull()
      .references(() => sellerProfiles.id, { onDelete: 'restrict' }),

    // --- (1) Lo declarado por el vendedor ---
    taxIdType: taxIdType('tax_id_type').notNull(),
    /** SOLO DIGITOS, sin guiones. El formateo para mostrar es de la UI. */
    taxId: text('tax_id').notNull(),

    // --- (2) Resultado de la verificacion contra la fuente oficial ---
    verificationStatus: taxVerificationStatus('verification_status').notNull().default('PENDING'),
    /** Que fuente respondio (ej. 'ARCA'). Null mientras no haya integracion. */
    source: text('source'),
    /** Cuando se consulto la fuente. Null mientras no haya integracion. */
    checkedAt: timestamp('checked_at', { withTimezone: true }),

    // --- (3) Lo que dijo la fuente ---
    /**
     * `text` y no enum A PROPOSITO: los valores concretos los define la fuente
     * fiscal y todavia no se conocen. Fijarlos ahora seria inventarlos.
     */
    taxCondition: text('tax_condition'),

    // --- Vigencia (historial) ---
    validFrom: timestamp('valid_from', { withTimezone: true }).notNull().defaultNow(),
    /** Null = fila VIGENTE. Se completa al reemplazarla por una nueva. */
    validTo: timestamp('valid_to', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }),
  },
  (t) => [
    /** Una sola fila vigente por vendedor; las historicas quedan. */
    uniqueIndex('seller_tax_profiles_current_key')
      .on(t.sellerId)
      .where(sql`${t.validTo} IS NULL`),
    index('seller_tax_profiles_seller_id_idx').on(t.sellerId),
    index('seller_tax_profiles_verification_status_idx').on(t.verificationStatus),
    index('seller_tax_profiles_tax_id_idx').on(t.taxId),
  ],
);

/**
 * ERD §7.4 — CACHE DERIVADO (DEC-036).
 *
 * ⚠️ YA NO ES FUENTE DE VERDAD. Es una proyeccion recomputable desde
 * `user_history_events`. `score` es derivado y NO tiene autoridad: si se pierde
 * o cambia la formula, se recalcula desde el historial.
 *
 * PK = seller_id (relacion 1:1 con `seller_profiles`).
 */
export const sellerReputations = pgTable('seller_reputations', {
  sellerId: uuid('seller_id')
    .primaryKey()
    .references(() => sellerProfiles.id, { onDelete: 'restrict' }),
  salesCount: integer('sales_count').notNull().default(0),
  cancellationsCount: integer('cancellations_count').notNull().default(0),
  claimsCount: integer('claims_count').notNull().default(0),
  refundsCount: integer('refunds_count').notNull().default(0),
  avgDispatchHours: numeric('avg_dispatch_hours', { precision: 8, scale: 2 }),
  ratingAvg: numeric('rating_avg', { precision: 3, scale: 2 }),
  ratingCount: integer('rating_count').notNull().default(0),
  counterfeitFlags: integer('counterfeit_flags').notNull().default(0),
  /** Derivado, NO autoridad (DEC-036). Nullable y recomputable. */
  score: numeric('score', { precision: 6, scale: 2 }),
  computedAt: timestamp('computed_at', { withTimezone: true }),
});
