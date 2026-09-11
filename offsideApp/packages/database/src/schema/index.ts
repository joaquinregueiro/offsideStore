/**
 * Schema de Drizzle — traduccion fiel del ERD v1.0.
 *
 * =============================================================================
 * FUENTE DE VERDAD: docs/04-technical/database-design.md (ERD v1.0 CERRADO)
 * =============================================================================
 *
 * Flujo obligatorio, en un solo sentido (CLAUDE.md §6):
 *
 *     ERD  ->  Drizzle Schema  ->  Migration  ->  PostgreSQL
 *
 * Drizzle IMPLEMENTA el ERD. Drizzle NO redefine el ERD. Si algo del ERD no
 * puede expresarse aca, se DETIENE y se pide decision: no se resuelve
 * inventando en el codigo.
 *
 * 52 tablas y 38 enums (ERD v1.3 §24), mas tres tablas de los dos deltas que
 * el owner autorizo el 2026-09-10 (`listing_questions`, `listing_promotions`,
 * `listing_reports`; ver `docs-implementation/erd-delta-2026-09-10.md`): 55 en
 * total. Un archivo por modulo del ERD §2; los deltas, en archivos propios.
 *
 * ⚠️ La migracion inicial DEBE crear TRES extensiones antes de las tablas que
 *    las usan (ERD §1.b). Drizzle Kit NO las genera:
 *
 *        CREATE EXTENSION IF NOT EXISTS citext;    -- users.email
 *        CREATE EXTENSION IF NOT EXISTS unaccent;  -- busqueda en español
 *        CREATE EXTENSION IF NOT EXISTS pg_trgm;   -- indices trigram (§9.1)
 *
 *    Ver docs-implementation/erd-to-drizzle.md.
 */

// --- Tipos y enums compartidos ---
export * from './_custom-types';
export * from './_enums';

// --- Modulos de dominio (orden del ERD §2) ---
export * from './auth';
export * from './users';
export * from './sellers';
export * from './catalog';
export * from './listings';
export * from './questions';
// --- Deltas al ERD v1.3 (owner, 2026-09-10) ---
export * from './promotions';
export * from './reports';
export * from './cart';
export * from './orders';
export * from './payments';
export * from './shipments';
export * from './disputes';
export * from './reviews';
export * from './trust';
export * from './config';
export * from './notifications';
export * from './audit';

// --- Relaciones (API `relations` de Drizzle, para consultas anidadas) ---
export * from './relations';
