import { getDatabase, schema, type Database } from '@offside/database';
import { and, asc, eq, inArray } from 'drizzle-orm';

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
 * Una entrada ACTIVA por su slug, para las pantallas de catalogo.
 *
 * ⚠️ SE BUSCA POR SLUG Y NO POR ID PORQUE ES UNA URL PUBLICA. `/club/river-plate`
 * se comparte, se lee y lo indexa un buscador; `/club/9c60fd3e-…` no significa
 * nada para nadie y cambia si algun dia se resiembra el catalogo. El slug ya es
 * UNIQUE en las seis tablas (ERD §8), asi que no hizo falta tocar el esquema.
 *
 * ⚠️ FILTRA POR `is_active` IGUAL QUE `findActive`: dar de baja una entrada tiene
 * que apagar tambien su pantalla, no dejarla indexada con un catalogo que ya no
 * se ofrece.
 */
export async function findActiveBySlug(
  catalogo: NombreDeCatalogo,
  slug: string,
  db?: Database,
): Promise<CatalogRow | undefined> {
  const tabla = TABLAS[catalogo];

  const [fila] = await conn(db)
    .select({ id: tabla.id, name: tabla.name, slug: tabla.slug, aliases: tabla.aliases })
    .from(tabla)
    .where(and(eq(tabla.slug, slug), eq(tabla.isActive, true)))
    .limit(1);

  return fila;
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

/**
 * Nombre y slug de varias entradas, por id.
 *
 * ⚠️ DEVUELVE TAMBIEN EL SLUG, y no es de adorno: es lo que deja que una faceta
 * enlace a `/club/river-plate` en vez de a `/buscar?club=<uuid>`. Sin el, los
 * unicos enlaces internos a las pantallas de catalogo serian los del sitemap, y
 * una pagina a la que no apunta nadie desde adentro del sitio arranca sin
 * ninguna señal para el buscador.
 */
export async function entradasPorId(
  catalogo: NombreDeCatalogo,
  ids: string[],
  db?: Database,
): Promise<Map<string, { name: string; slug: string }>> {
  if (ids.length === 0) return new Map();

  const tabla = TABLAS[catalogo];

  const filas = await conn(db)
    .select({ id: tabla.id, name: tabla.name, slug: tabla.slug })
    .from(tabla)
    .where(inArray(tabla.id, ids));

  return new Map(filas.map((fila) => [fila.id, { name: fila.name, slug: fila.slug }]));
}
