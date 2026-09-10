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
 * 50 tablas y 35 enums (ERD v1.1 §24). Un archivo por modulo del ERD §2.
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
