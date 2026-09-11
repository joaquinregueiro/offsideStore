import * as errors from '../listings.errors';
import { SEARCH_ORDERS, type SearchOrder } from '../repositories/search.repository';

/**
 * Validacion PURA de la consulta de busqueda (PS-021 / PS-023).
 *
 * La pantalla arma la consulta desde la URL, asi que todo lo que llega es
 * texto de cualquiera. El Service valida en el borde (CLAUDE.md §9); el
 * repositorio parametriza pero no interpreta.
 */

/**
 * Los ordenes que la busqueda acepta (PS-021).
 *
 * `popularidad` NO esta: no hay metricas de visitas ni de ventas por
 * publicacion. `reputacion` ordena por `seller_reputations.score`, que es una
 * proyeccion derivada (DEC-036) y puede no existir todavia para un vendedor:
 * esos van al final (`NULLS LAST`), no afuera.
 */
export { SEARCH_ORDERS, type SearchOrder };

export function isSearchOrder(valor: unknown): valor is SearchOrder {
  return typeof valor === 'string' && (SEARCH_ORDERS as readonly string[]).includes(valor);
}

/**
 * Traduce `?orden=` a un orden valido. `undefined` o vacio es "el de por
 * defecto"; cualquier otra cosa que no este en la lista se rechaza en vez de
 * caer en relevancia por un `else`, que es lo que hacia que la URL dijera una
 * cosa y la pantalla mostrara otra.
 */
export function parseSearchOrder(valor: unknown): SearchOrder | undefined {
  if (valor === undefined || valor === null || valor === '') return undefined;
  if (!isSearchOrder(valor)) throw errors.invalidSearchOrder();

  return valor;
}

export interface PriceRange {
  /** Centavos. */
  precioMin?: bigint | undefined;
  precioMax?: bigint | undefined;
}

/**
 * Valida el filtro de precio: enteros en centavos, `>= 0`, `min <= max`.
 *
 * El dinero es `bigint`, asi que "entero" ya lo garantiza el tipo; lo que hay
 * que rechazar es lo negativo y el rango vacio. Un rango con `min > max` no
 * devolveria nada y la pantalla diria "0 publicaciones" sin explicar por que.
 */
export function validatePriceRange(rango: PriceRange): PriceRange {
  const { precioMin, precioMax } = rango;

  if (precioMin !== undefined && precioMin < 0n) {
    throw errors.invalidPriceRange('el mínimo no puede ser negativo');
  }

  if (precioMax !== undefined && precioMax < 0n) {
    throw errors.invalidPriceRange('el máximo no puede ser negativo');
  }

  if (precioMin !== undefined && precioMax !== undefined && precioMin > precioMax) {
    throw errors.invalidPriceRange('el mínimo no puede superar al máximo');
  }

  return {
    ...(precioMin === undefined ? {} : { precioMin }),
    ...(precioMax === undefined ? {} : { precioMax }),
  };
}

/**
 * Lee un importe en centavos desde texto (la URL). `undefined` si esta vacio.
 *
 * Solo digitos: un `-`, un punto o una coma no son "cero", son un error que
 * la persona tiene que ver.
 */
export function parsePriceParam(valor: string | undefined | null): bigint | undefined {
  if (valor === undefined || valor === null) return undefined;

  const limpio = valor.trim();
  if (limpio === '') return undefined;
  if (!/^\d+$/.test(limpio)) throw errors.invalidPriceRange('el precio tiene que ser un número');

  return BigInt(limpio);
}
