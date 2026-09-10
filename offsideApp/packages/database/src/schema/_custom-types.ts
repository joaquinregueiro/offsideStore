import { customType } from 'drizzle-orm/pg-core';

/**
 * Tipos de PostgreSQL que Drizzle no expone de forma nativa.
 *
 * El ERD v1.0 los usa explicitamente, asi que se declaran aca en vez de
 * sustituirlos por otro tipo (lo que seria reinterpretar el ERD).
 */

/**
 * `citext` — texto case-insensitive. ERD §5.1: `users.email`.
 *
 * ⚠️ REQUIERE LA EXTENSION: la migracion debe ejecutar
 * `CREATE EXTENSION IF NOT EXISTS citext;` ANTES de crear `users`.
 * Drizzle Kit no genera esa sentencia solo.
 */
export const citext = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'citext';
  },
});

/**
 * `tsvector` — vector de busqueda full-text. ERD §9.1: `listings.search_vector`,
 * indexado con GIN (§19.2).
 *
 * ⚠️ El ERD lo describe como "Generated/trigger": el POBLADO de la columna
 * (columna generada o trigger) no esta definido y se resuelve al implementar
 * busqueda. Aca solo se declara el tipo.
 */
export const tsvector = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'tsvector';
  },
});
