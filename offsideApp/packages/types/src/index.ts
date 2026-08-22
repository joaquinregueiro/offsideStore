/**
 * Tipos compartidos entre apps y packages.
 *
 * ALCANCE: solo tipos transversales de infraestructura. Los tipos de dominio
 * (Order, Payment, Listing, ...) NO van aca: pertenecen a su modulo y se derivan
 * del schema de Drizzle, que a su vez implementa el ERD v1.0. Ver CLAUDE.md §6.
 */

/** Marca de dinero: SIEMPRE centavos en entero, nunca float (ERD §1). */
export type Cents = bigint;

/** Codigo de moneda ISO 4217. Toda tabla con importes lleva su `currency`. */
export type CurrencyCode = string & { readonly __brand: 'CurrencyCode' };

/**
 * Resultado explicito para operaciones que pueden fallar de forma esperable.
 * Evita usar excepciones como control de flujo en la capa de Service.
 */
export type Result<T, E = Error> = { ok: true; value: T } | { ok: false; error: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

/** Todas las propiedades de T, recursivamente, en solo lectura. */
export type DeepReadonly<T> = {
  readonly [K in keyof T]: T[K] extends object ? DeepReadonly<T[K]> : T[K];
};
