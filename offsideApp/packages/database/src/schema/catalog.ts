import {
  boolean,
  char,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { catalogRequestStatus, catalogTargetType, garmentCategory } from './_enums';
import { users } from './auth';

/**
 * Modulo CATALOG — ERD v1.0 §8.
 *
 * Forma comun de todas las tablas del modulo:
 *   id, name, slug UNIQUE, aliases text[], is_active, timestamps
 *
 * `aliases` alimenta los sinonimos de la busqueda (ERD §19.2).
 */

/** Campos compartidos por los catalogos. Se repiten explicitamente en cada tabla. */
const catalogBase = {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  slug: text('slug').notNull(),
  aliases: text('aliases').array(),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }),
};

export const categories = pgTable(
  'categories',
  {
    ...catalogBase,
    code: garmentCategory('code').notNull(),
    /** 🟦 OQ-F1: la matriz de atributos obligatorios por categoria esta PENDING. */
    requiredAttributes: jsonb('required_attributes'),
  },
  (t) => [
    uniqueIndex('categories_slug_key').on(t.slug),
    uniqueIndex('categories_code_key').on(t.code),
  ],
);

export const clubs = pgTable('clubs', catalogBase, (t) => [
  uniqueIndex('clubs_slug_key').on(t.slug),
]);

export const nationalTeams = pgTable('national_teams', catalogBase, (t) => [
  uniqueIndex('national_teams_slug_key').on(t.slug),
]);

export const brands = pgTable('brands', catalogBase, (t) => [
  uniqueIndex('brands_slug_key').on(t.slug),
]);

export const competitions = pgTable('competitions', catalogBase, (t) => [
  uniqueIndex('competitions_slug_key').on(t.slug),
]);

export const countries = pgTable(
  'countries',
  {
    ...catalogBase,
    isoCode: char('iso_code', { length: 2 }).notNull(),
  },
  (t) => [
    uniqueIndex('countries_slug_key').on(t.slug),
    uniqueIndex('countries_iso_code_key').on(t.isoCode),
  ],
);

export const seasons = pgTable(
  'seasons',
  {
    ...catalogBase,
    /** Etiqueta de temporada (ej. "2024/25"). UNIQUE por ERD §8. */
    label: text('label').notNull(),
  },
  (t) => [uniqueIndex('seasons_slug_key').on(t.slug), uniqueIndex('seasons_label_key').on(t.label)],
);

/**
 * ERD §8 — 🟦 OQ-F3: la estructura de talles esta PENDING.
 * Solo se crea la forma comun; las columnas propias se definen al resolver OQ-F3.
 */
export const sizeCharts = pgTable('size_charts', catalogBase, (t) => [
  uniqueIndex('size_charts_slug_key').on(t.slug),
]);

/**
 * ERD §8.1 (v1.1, DEC-041) — solicitud de ALTA de un item de catalogo controlado.
 *
 * ⚠️ NO sigue la "forma comun" del modulo: no es un catalogo, es una solicitud.
 *
 * Existe para que un vendedor pueda proponer un club/marca/competicion que falta
 * SIN escribir directamente en las tablas de catalogo. Evita los "datos sucios"
 * que `product-specification.md` §11 identifica como el riesgo que mata el
 * diferencial de la busqueda facetada.
 *
 * REGLA DURA: la solicitud NO modifica el catalogo. Solo la APROBACION crea la
 * entidad, y su id queda en `created_entity_id`.
 *
 * AUTORIZACION: quien puede crear solicitudes y quien puede aprobarlas se
 * resuelve en la CAPA DE PERMISOS (roles de DEC-023), no en el modelo de datos.
 * Por eso `requested_by` apunta a `users` y no a `seller_profiles`: la tabla no
 * se acopla al rol. 🟡 Los permisos granulares siguen PENDING (DEC-023 / OQ-F2).
 */
export const catalogChangeRequests = pgTable(
  'catalog_change_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    targetType: catalogTargetType('target_type').notNull(),
    /** SNAPSHOT INMUTABLE de la propuesta original, tal como se envio. */
    payload: jsonb('payload').notNull(),
    requestedBy: uuid('requested_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    status: catalogRequestStatus('status').notNull().default('PENDING'),
    /** Null hasta que se revise. */
    reviewedBy: uuid('reviewed_by').references(() => users.id, { onDelete: 'restrict' }),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    /** Motivo de la resolucion. Obligatorio al rechazar (validado en app). */
    reviewNote: text('review_note'),
    /**
     * Entidad creada al aprobar. SIN FK: la tabla destino depende de
     * `target_type` (referencia polimorfica, igual que `audit_log.entity_id`).
     */
    createdEntityId: uuid('created_entity_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }),
  },
  (t) => [
    index('catalog_change_requests_status_idx').on(t.status),
    index('catalog_change_requests_requested_by_idx').on(t.requestedBy),
    index('catalog_change_requests_target_type_idx').on(t.targetType),
  ],
);
