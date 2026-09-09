import { getDatabase, schema, type Database } from '@offside/database';
import { asc, eq, inArray } from 'drizzle-orm';

/**
 * Acceso a los catalogos controlados (ERD §8, `product-specification.md` §4.3).
 *
 * Las seis tablas comparten forma —`id, name, slug, aliases, is_active`— asi que
 * comparten helper en vez de repetir seis consultas iguales.
 *
 * ⚠️ NO INCLUYE `categories`. La documentacion la excluye explicitamente de los
 * catalogos controlados: es un conjunto fijo respaldado por el enum
 * `garment_category` y no se propone (DEC-041). Vive en `listing.repository`.
 */

const conn = (db?: Database): Database => db ?? getDatabase();

/** Una entrada de catalogo, en la forma comun del ERD §8. */
export interface CatalogRow {
  id: string;
  name: string;
  slug: string;
  aliases: string[] | null;
}

/** Los catalogos que se pueden elegir al publicar. */
export const TABLAS = {
  club: schema.clubs,
  nationalTeam: schema.nationalTeams,
  brand: schema.brands,
  competition: schema.competitions,
  season: schema.seasons,
  country: schema.countries,
} as const;

export type NombreDeCatalogo = keyof typeof TABLAS;

/**
 * Entradas activas de un catalogo.
 *
 * ⚠️ Se filtra por `is_active`: dar de baja una entrada tiene que sacarla de
 * los formularios sin borrar la fila, porque las publicaciones que ya la usan
 * la referencian con FK.
 */
export async function findActive(catalogo: NombreDeCatalogo, db?: Database): Promise<CatalogRow[]> {
  const tabla = TABLAS[catalogo];

  const filas = await conn(db)
    .select({ id: tabla.id, name: tabla.name, slug: tabla.slug, aliases: tabla.aliases })
    .from(tabla)
    .where(eq(tabla.isActive, true))
    .orderBy(asc(tabla.name));

  return filas.map((fila) => ({
    id: fila.id,
    name: fila.name,
    slug: fila.slug,
    aliases: fila.aliases,
  }));
}

/**
 * Nombres y alias de las entradas que referencia una publicacion.
 *
 * ⚠️ ESTO ES LO QUE ALIMENTA PS-024. El indice de busqueda tiene que contener
 * "River Plate", "River" y "CARP" para que las tres encuentren la misma
 * camiseta. Por eso DEC-042 decidio que `search_vector` lo poblara el Service:
 * una columna generada no puede leer otra tabla.
 */
export async function textoDeCatalogos(
  refs: {
    clubId: string | null;
    nationalTeamId: string | null;
    brandId: string | null;
    competitionId: string | null;
    seasonId: string | null;
  },
  db?: Database,
): Promise<string> {
  const pedidos: [NombreDeCatalogo, string][] = [];

  if (refs.clubId !== null) pedidos.push(['club', refs.clubId]);
  if (refs.nationalTeamId !== null) pedidos.push(['nationalTeam', refs.nationalTeamId]);
  if (refs.brandId !== null) pedidos.push(['brand', refs.brandId]);
  if (refs.competitionId !== null) pedidos.push(['competition', refs.competitionId]);
  if (refs.seasonId !== null) pedidos.push(['season', refs.seasonId]);

  if (pedidos.length === 0) return '';

  const partes: string[] = [];

  // Una consulta por catalogo, no una por referencia: son cinco como maximo.
  for (const [catalogo, id] of pedidos) {
    const tabla = TABLAS[catalogo];

    const [fila] = await conn(db)
      .select({ name: tabla.name, aliases: tabla.aliases })
      .from(tabla)
      .where(eq(tabla.id, id))
      .limit(1);

    if (fila === undefined) continue;

    partes.push(fila.name);
    if (fila.aliases !== null) partes.push(...fila.aliases);
  }

  return partes.join(' ');
}

/** Nombres de varias entradas de un catalogo, para mostrar facetas. */
export async function nombresPorId(
  catalogo: NombreDeCatalogo,
  ids: string[],
  db?: Database,
): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();

  const tabla = TABLAS[catalogo];

  const filas = await conn(db)
    .select({ id: tabla.id, name: tabla.name })
    .from(tabla)
    .where(inArray(tabla.id, ids));

  return new Map(filas.map((fila) => [fila.id, fila.name]));
}
