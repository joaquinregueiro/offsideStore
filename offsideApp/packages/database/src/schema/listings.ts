import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  char,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { tsvector } from './_custom-types';
import {
  authenticity,
  itemCondition,
  kitType,
  listingStatus,
  moderationStatus,
  sleeve,
  versionType,
} from './_enums';
import { users } from './auth';
import {
  brands,
  categories,
  clubs,
  competitions,
  countries,
  nationalTeams,
  seasons,
} from './catalog';
import { sellerProfiles } from './sellers';

/**
 * Modulo LISTINGS — ERD v1.0 §9.
 * Tablas: listings, listing_images, listing_price_history.
 */

/**
 * ERD §9.1 — publicacion. Modelo especializado de futbol.
 *
 * Regla de compra (ERD §9.1): una publicacion es comprable SOLO si
 * `status='active'` Y `moderation_status='APPROVED'` Y `stock >= 1`.
 * `moderation_status` es INDEPENDIENTE de `status` (decision Fase 2 §6).
 */
export const listings = pgTable(
  'listings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sellerId: uuid('seller_id')
      .notNull()
      .references(() => sellerProfiles.id, { onDelete: 'restrict' }),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'restrict' }),
    /** SKU del vendedor. UNIQUE por vendedor solo cuando no es null. */
    sku: text('sku'),
    status: listingStatus('status').notNull().default('draft'),
    /** Independiente de `status`. */
    moderationStatus: moderationStatus('moderation_status').notNull().default('PENDING'),
    title: text('title').notNull(),
    description: text('description'),
    /** Dinero: bigint en CENTAVOS (ERD §1). Nunca float. */
    priceAmount: bigint('price_amount', { mode: 'bigint' }).notNull(),
    currency: char('currency', { length: 3 }).notNull().default('ARS'),
    /** Se descuenta atomicamente con el pago (MF-022, anti-overselling). */
    stock: integer('stock').notNull().default(1),

    // --- Catalogos (todos opcionales) ---
    clubId: uuid('club_id').references(() => clubs.id, { onDelete: 'restrict' }),
    nationalTeamId: uuid('national_team_id').references(() => nationalTeams.id, {
      onDelete: 'restrict',
    }),
    brandId: uuid('brand_id').references(() => brands.id, { onDelete: 'restrict' }),
    competitionId: uuid('competition_id').references(() => competitions.id, {
      onDelete: 'restrict',
    }),
    /** Pais de fabricacion. */
    countryId: uuid('country_id').references(() => countries.id, { onDelete: 'restrict' }),
    seasonId: uuid('season_id').references(() => seasons.id, { onDelete: 'restrict' }),

    // --- Atributos especializados ---
    year: integer('year'),
    model: text('model'),
    version: versionType('version'),
    /** Obligatorio para camiseta (validado en app, no por CHECK). */
    kitType: kitType('kit_type'),
    /** Obligatorio para camiseta (validado en app, no por CHECK). */
    sleeve: sleeve('sleeve'),
    playerName: text('player_name'),
    playerNumber: integer('player_number'),
    sponsor: text('sponsor'),
    /** Normalizado contra `size_charts`. */
    sizeValue: text('size_value').notNull(),
    /** { chest_cm, length_cm } */
    measurements: jsonb('measurements'),
    condition: itemCondition('condition').notNull(),
    /** Declarada por el vendedor (TS-030/032). */
    authenticity: authenticity('authenticity').notNull().default('NO_ESPECIFICADA'),
    /** 🟦 La definicion de retro/vintage esta PENDING (OQ-F4). */
    isRetro: boolean('is_retro').notNull().default(false),

    /** Full-text (ERD §19.2). El poblado (columna generada o trigger) es 🟦. */
    searchVector: tsvector('search_vector'),
    extraAttributes: jsonb('extra_attributes'),

    publishedAt: timestamp('published_at', { withTimezone: true }),

    // --- Promocion (delta al ERD v1.3, autorizado por el owner 2026-09-10) ---
    /**
     * ⚠️ NO ESTA EN EL ERD v1.3. Publicaciones promocionadas con comision
     * mayor: cambio ARQUITECTONICO autorizado por el owner. Delta documentado
     * en `docs-implementation/erd-delta-2026-09-10.md` hasta que llegue al ERD.
     *
     * Una publicacion esta promocionada MIENTRAS `now() < promoted_until`. Es
     * un PREDICADO DERIVADO, no un estado: no se toca `status`, y al vencer no
     * hay que "despromocionar" nada —la fila queda como evidencia de que estuvo
     * promocionada—. Mismo criterio que el vendedor desconectado (SS-013).
     *
     * ⚙️ La duracion y el multiplicador de comision salen del Config Store
     * (`promotion_duration_days`, `promotion_commission_multiplier`); aca solo
     * se guarda el instante ya calculado. La orden snapshotea el multiplicador
     * aplicado (`orders.promotion_multiplier_at_transaction`, DEC-030).
     */
    promotedUntil: timestamp('promoted_until', { withTimezone: true }),
    /** Cuando se promociono por ultima vez. Solo trazabilidad. */
    promotedAt: timestamp('promoted_at', { withTimezone: true }),

    // --- Envio declarado (segundo delta del 2026-09-10, autorizado por el owner) ---
    /**
     * ⚠️ NO ESTA EN EL ERD v1.3 (ver `docs-implementation/erd-delta-2026-09-10.md`).
     *
     * Como se resuelve el envio de ESTA publicacion, DECLARADO por el
     * vendedor. `shipping.md` §5.b deja "quien paga" y "retiro presencial" 🟡
     * y la cotizacion (SH-011) depende de Correo Argentino, que no existe: sin
     * esto no hay ninguna forma de que el comprador sepa cuanto paga de envio.
     *
     *   included   → el precio ya lo incluye; `shipping_cost_amount` NULL
     *   buyer_pays → lo paga el comprador; `shipping_cost_amount` OBLIGATORIO
     *                (validado en app, no por CHECK: el modo puede cambiar
     *                antes que el importe en un mismo formulario)
     *   to_agree   → se arregla entre las partes; `shipping_cost_amount` NULL
     *   pickup     → retiro en persona; `shipping_cost_amount` NULL
     *
     * ⚙️ El modo por defecto al publicar y si `pickup` esta habilitado salen
     * del Config Store (`shipping_default_mode`, `shipping_pickup_allowed`); el
     * DEFAULT de la columna solo cubre filas anteriores a esta migracion.
     * `text` con CHECK y no enum, como los demas estados de este delta.
     */
    shippingMode: text('shipping_mode').notNull().default('to_agree'),
    /**
     * Costo de envio declarado, en CENTAVOS (ERD §1). Se CONGELA en
     * `orders.shipping_amount` al crear la orden (DEC-030): cambiarlo despues
     * no toca ordenes existentes, igual que el precio (BR-023).
     */
    shippingCostAmount: bigint('shipping_cost_amount', { mode: 'bigint' }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }),
    /** Soft delete (ERD §20.10). */
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    /**
     * PARCIAL a proposito: la inmensa mayoria de las filas tendra
     * `promoted_until` NULL y no aporta nada indexarlas. La vitrina y la
     * busqueda consultan `promoted_until > now()`, que cae en el rango del
     * indice.
     */
    index('listings_promoted_until_idx')
      .on(t.promotedUntil)
      .where(sql`${t.promotedUntil} IS NOT NULL`),
    uniqueIndex('listings_seller_id_sku_key')
      .on(t.sellerId, t.sku)
      .where(sql`${t.sku} IS NOT NULL`),
    index('listings_seller_id_idx').on(t.sellerId),
    index('listings_status_idx').on(t.status),
    index('listings_moderation_status_idx').on(t.moderationStatus),
    index('listings_category_id_idx').on(t.categoryId),
    index('listings_club_id_idx').on(t.clubId),
    index('listings_national_team_id_idx').on(t.nationalTeamId),
    index('listings_brand_id_idx').on(t.brandId),
    index('listings_competition_id_idx').on(t.competitionId),
    index('listings_season_id_idx').on(t.seasonId),
    index('listings_price_amount_idx').on(t.priceAmount),
    index('listings_condition_idx').on(t.condition),
    index('listings_authenticity_idx').on(t.authenticity),
    index('listings_is_retro_idx').on(t.isRetro),
    index('listings_search_vector_idx').using('gin', t.searchVector),
    index('listings_extra_attributes_idx').using('gin', t.extraAttributes),
    /**
     * Trigram (ERD v1.1 §9.1, DEC-042) — tolerancia a errores de escritura
     * (PS-020.b). Solo campos cortos y de alta señal; `description` queda
     * excluida a proposito por costo de indice.
     * Requiere la extension `pg_trgm` (ERD §1.b).
     */
    index('listings_title_trgm_idx').using('gin', sql`${t.title} gin_trgm_ops`),
    index('listings_player_name_trgm_idx').using('gin', sql`${t.playerName} gin_trgm_ops`),
    index('listings_model_trgm_idx').using('gin', sql`${t.model} gin_trgm_ops`),
    // Compuestos de busqueda facetada (ERD §9.1).
    index('listings_status_category_club_idx').on(t.status, t.categoryId, t.clubId),
    index('listings_status_price_idx').on(t.status, t.priceAmount),
    check('listings_stock_check', sql`${t.stock} >= 0`),
    check('listings_price_amount_check', sql`${t.priceAmount} > 0`),
    check(
      'listings_shipping_mode_check',
      sql`${t.shippingMode} IN ('included', 'buyer_pays', 'to_agree', 'pickup')`,
    ),
    /** Null = no aplica; si esta, no puede ser negativo (es plata del comprador). */
    check(
      'listings_shipping_cost_amount_check',
      sql`${t.shippingCostAmount} IS NULL OR ${t.shippingCostAmount} >= 0`,
    ),
  ],
);

/** ERD §9.2 — imagenes. Se requiere >=1 para publicar (PS-010, validado en app). */
export const listingImages = pgTable(
  'listing_images',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    listingId: uuid('listing_id')
      .notNull()
      .references(() => listings.id, { onDelete: 'cascade' }),
    storageKey: text('storage_key').notNull(),
    url: text('url'),
    /** Variantes generadas (thumbnail/medium/large). */
    variants: jsonb('variants'),
    position: integer('position').notNull(),
    alt: text('alt'),
    hash: text('hash'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('listing_images_listing_id_position_key').on(t.listingId, t.position),
    index('listing_images_listing_id_idx').on(t.listingId),
  ],
);

/**
 * ERD §9.3 — historial de precios.
 * Se escribe ante cambios de `price_amount` (junto con `audit_log`, BR-015).
 */
export const listingPriceHistory = pgTable(
  'listing_price_history',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    listingId: uuid('listing_id')
      .notNull()
      .references(() => listings.id, { onDelete: 'cascade' }),
    oldPriceAmount: bigint('old_price_amount', { mode: 'bigint' }),
    newPriceAmount: bigint('new_price_amount', { mode: 'bigint' }).notNull(),
    currency: char('currency', { length: 3 }).notNull().default('ARS'),
    changedBy: uuid('changed_by').references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('listing_price_history_listing_id_idx').on(t.listingId)],
);
