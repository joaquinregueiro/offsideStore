import { getDatabase, schema, type Database } from '@offside/database';
import { eq, sql } from 'drizzle-orm';

/**
 * Busqueda de publicaciones (PS-020 … PS-023, DEC-042).
 *
 * ⚠️ ES SQL CRUDO A PROPOSITO. Drizzle no expresa `tsquery`, `ts_rank` ni
 * `similarity`, y forzarlo con su API produciria algo menos legible que el SQL
 * que realmente corre. Todo parametro del usuario va **parametrizado**, nunca
 * interpolado: `sql` de Drizzle produce placeholders, no concatenacion.
 *
 * ⚠️ EL FILTRO DE VISIBILIDAD ES EL MISMO QUE EL DE LA VITRINA (ERD §9.1 +
 * SS-013): `status = 'active'`, `moderation_status = 'APPROVED'`, `stock >= 1`
 * y **el vendedor puede operar**. Si la busqueda mostrara algo que la compra
 * rechaza, prometeria lo que no cumple.
 */

const conn = (db?: Database): Database => db ?? getDatabase();

export interface SearchFilters {
  categoryId?: string;
  sizeValue?: string;
  condition?: string;
  kitType?: string;
  sleeve?: string;
  clubId?: string;
  nationalTeamId?: string;
  brandId?: string;
  competitionId?: string;
  seasonId?: string;
  /** Centavos. */
  precioMin?: bigint;
  precioMax?: bigint;
}

export type SearchOrder = 'relevancia' | 'precio_asc' | 'precio_desc' | 'recientes';

export interface SearchRow {
  id: string;
  title: string;
  priceAmount: bigint;
  currency: string;
  sizeValue: string;
  condition: string;
  sellerDisplayName: string;
  rank: number;
}

/**
 * Recalcula el `search_vector` de una publicacion.
 *
 * ⚠️ LO PUEBLA EL SERVICE, NO UN TRIGGER (DEC-042), y ahora se ve por que: el
 * `textoDeCatalogos` que recibe trae los NOMBRES Y ALIAS del club, la marca, la
 * competicion y la temporada, leidos de otras tablas. Una columna generada no
 * puede hacer eso, y un trigger meteria logica de ranking en PL/pgSQL.
 *
 * ⚠️ LOS ALIAS PESAN COMO EL TITULO ('A'). Es lo que hace que "CARP" encuentre
 * "River Plate" con la misma fuerza que si el vendedor lo hubiera escrito
 * (PS-024). Ponerlos en 'C' los volveria casi invisibles frente al titulo.
 *
 * Las etiquetas A..D son ESTRUCTURA —que campo pesa en que categoria—; cuanto
 * pesa cada categoria es ⚙️ configurable y se aplica al CONSULTAR, no al
 * indexar. Por eso cambiar los pesos no obliga a reindexar nada.
 */
export async function reindexListing(
  listingId: string,
  textoDeCatalogos: string,
  db?: Database,
): Promise<void> {
  await conn(db).execute(sql`
    UPDATE listings
       SET search_vector =
             setweight(to_tsvector('spanish', unaccent(coalesce(title, ''))), 'A')
          || setweight(to_tsvector('spanish', unaccent(${textoDeCatalogos})), 'A')
          || setweight(to_tsvector('spanish', unaccent(coalesce(player_name, '') || ' ' || coalesce(model, ''))), 'B')
          || setweight(to_tsvector('spanish', unaccent(coalesce(description, ''))), 'C')
     WHERE id = ${listingId}
  `);
}

/**
 * El vendedor puede operar (SS-013), expresado en SQL.
 *
 * ⚠️ ES UN `EXISTS` Y NO UN JOIN A PROPOSITO. Esta condicion la usan los tres
 * caminos —resultados, conteo total y CADA faceta—, y dos de ellos consultan
 * `FROM listings l` a secas. Con un join habria que agregarlo en tres lugares y
 * acordarse de sumarlo a cada faceta nueva; dentro de `condiciones()` entra
 * solo. Ademas un `EXISTS` no puede multiplicar filas, asi que los conteos de
 * las facetas siguen siendo exactos.
 *
 * Si las facetas no lo aplicaran, dirian "River Plate (3)" y la busqueda
 * devolveria dos: un filtro que miente sobre lo que hay.
 */
const VENDEDOR_OPERATIVO = sql`EXISTS (
  SELECT 1
    FROM seller_profiles sp
    JOIN mercadopago_accounts mp ON mp.seller_id = sp.id
   WHERE sp.id = l.seller_id
     AND sp.status = 'approved'
     AND mp.status = 'connected'
)`;

/** Condiciones de visibilidad + filtros. Se comparte entre resultados y facetas. */
function condiciones(filtros: SearchFilters) {
  const partes = [
    sql`l.status = 'active'`,
    sql`l.moderation_status = 'APPROVED'`,
    sql`l.stock >= 1`,
    sql`l.deleted_at IS NULL`,
    VENDEDOR_OPERATIVO,
  ];

  if (filtros.categoryId !== undefined) partes.push(sql`l.category_id = ${filtros.categoryId}`);
  if (filtros.sizeValue !== undefined) partes.push(sql`l.size_value = ${filtros.sizeValue}`);
  if (filtros.condition !== undefined) {
    partes.push(sql`l.condition = ${filtros.condition}::item_condition`);
  }
  if (filtros.kitType !== undefined) partes.push(sql`l.kit_type = ${filtros.kitType}::kit_type`);
  if (filtros.sleeve !== undefined) partes.push(sql`l.sleeve = ${filtros.sleeve}::sleeve`);
  if (filtros.clubId !== undefined) partes.push(sql`l.club_id = ${filtros.clubId}`);
  if (filtros.nationalTeamId !== undefined) {
    partes.push(sql`l.national_team_id = ${filtros.nationalTeamId}`);
  }
  if (filtros.brandId !== undefined) partes.push(sql`l.brand_id = ${filtros.brandId}`);
  if (filtros.competitionId !== undefined) {
    partes.push(sql`l.competition_id = ${filtros.competitionId}`);
  }
  if (filtros.seasonId !== undefined) partes.push(sql`l.season_id = ${filtros.seasonId}`);
  if (filtros.precioMin !== undefined) partes.push(sql`l.price_amount >= ${filtros.precioMin}`);
  if (filtros.precioMax !== undefined) partes.push(sql`l.price_amount <= ${filtros.precioMax}`);

  return sql.join(partes, sql` AND `);
}

/**
 * Coincidencia de texto.
 *
 * ⚠️ DOS MECANISMOS, Y HACEN FALTA LOS DOS (PS-020.b). El full-text encuentra
 * palabras completas con sus variantes; los TRIGRAMAS encuentran lo que esta
 * mal escrito. `"river 96 adidas"` lo resuelve el primero; `"rivre"` sólo el
 * segundo. Se combinan con OR: si cualquiera de los dos reconoce el texto, la
 * publicacion aparece.
 *
 * `websearch_to_tsquery` y no `plainto_tsquery`: entiende comillas y `-` para
 * excluir, que es lo que la gente ya sabe usar de otros buscadores.
 */
function coincideTexto(texto: string) {
  return sql`(
    l.search_vector @@ websearch_to_tsquery('spanish', unaccent(${texto}))
    OR similarity(unaccent(l.title), unaccent(${texto})) > 0.25
  )`;
}

export interface SearchInput {
  texto?: string;
  filtros: SearchFilters;
  orden: SearchOrder;
  /** Pesos {D,C,B,A} del Config Store (PS-021 / DEC-042). */
  pesos: number[];
  limite: number;
  offset: number;
}

export async function search(input: SearchInput, db?: Database): Promise<SearchRow[]> {
  const where =
    input.texto === undefined
      ? condiciones(input.filtros)
      : sql`${condiciones(input.filtros)} AND ${coincideTexto(input.texto)}`;

  // El ranking sólo tiene sentido si hay texto; sin él, `ts_rank` daria 0 para
  // todo y el orden por relevancia seria arbitrario.
  const rank =
    input.texto === undefined
      ? sql`0::float4`
      : sql`ts_rank(
            ${sql.raw(`ARRAY[${input.pesos.map((p) => Number(p)).join(',')}]::float4[]`)},
            l.search_vector,
            websearch_to_tsquery('spanish', unaccent(${input.texto}))
          )`;

  const orden =
    input.orden === 'precio_asc'
      ? sql`l.price_amount ASC`
      : input.orden === 'precio_desc'
        ? sql`l.price_amount DESC`
        : input.orden === 'recientes'
          ? sql`l.created_at DESC`
          : // Relevancia. El desempate por fecha evita que dos publicaciones con
            // el mismo rank salgan en orden distinto en cada consulta.
            sql`rank DESC, l.created_at DESC`;

  const filas = await conn(db).execute(sql`
    SELECT l.id, l.title, l.price_amount, l.currency, l.size_value, l.condition,
           s.display_name AS seller_display_name,
           ${rank} AS rank
      FROM listings l
      JOIN seller_profiles s ON s.id = l.seller_id
     WHERE ${where}
     ORDER BY ${orden}
     LIMIT ${input.limite} OFFSET ${input.offset}
  `);

  return (filas as unknown as Record<string, unknown>[]).map((row) => ({
    id: String(row.id),
    title: String(row.title),
    priceAmount: BigInt(String(row.price_amount)),
    currency: String(row.currency),
    sizeValue: String(row.size_value),
    condition: String(row.condition),
    sellerDisplayName: String(row.seller_display_name),
    rank: Number(row.rank),
  }));
}

/** Cuantos resultados hay en total, para paginar y para mostrar el numero. */
export async function countResults(
  input: Pick<SearchInput, 'texto' | 'filtros'>,
  db?: Database,
): Promise<number> {
  const where =
    input.texto === undefined
      ? condiciones(input.filtros)
      : sql`${condiciones(input.filtros)} AND ${coincideTexto(input.texto)}`;

  const filas = await conn(db).execute(sql`
    SELECT count(*)::int AS total FROM listings l WHERE ${where}
  `);

  return Number((filas as unknown as { total: number }[])[0]?.total ?? 0);
}

export interface FacetCount {
  valor: string;
  cantidad: number;
}

/**
 * Conteos de una faceta (PS-022).
 *
 * ⚠️ LA FACETA QUE SE CUENTA SE EXCLUYE DE SUS PROPIOS FILTROS. Es lo que
 * distingue una faceta util de una inutil: si ya elegiste "talle L" y contamos
 * los talles CON ese filtro puesto, la unica opcion visible seria L y no
 * podrias cambiar de idea sin borrar el filtro primero.
 *
 * El nombre de la columna NO viene del usuario: sale de un mapa cerrado.
 */
const COLUMNA_DE_FACETA = {
  categoryId: 'category_id',
  sizeValue: 'size_value',
  condition: 'condition',
  kitType: 'kit_type',
  sleeve: 'sleeve',
  clubId: 'club_id',
  nationalTeamId: 'national_team_id',
  brandId: 'brand_id',
  competitionId: 'competition_id',
  seasonId: 'season_id',
} as const;

export type NombreDeFaceta = keyof typeof COLUMNA_DE_FACETA;

export async function facetCounts(
  faceta: NombreDeFaceta,
  input: Pick<SearchInput, 'texto' | 'filtros'>,
  db?: Database,
): Promise<FacetCount[]> {
  const { [faceta]: _excluida, ...resto } = input.filtros;

  const base =
    input.texto === undefined
      ? condiciones(resto)
      : sql`${condiciones(resto)} AND ${coincideTexto(input.texto)}`;

  const columna = sql.raw(`l.${COLUMNA_DE_FACETA[faceta]}`);

  const filas = await conn(db).execute(sql`
    SELECT ${columna}::text AS valor, count(*)::int AS cantidad
      FROM listings l
     WHERE ${base} AND ${columna} IS NOT NULL
     GROUP BY ${columna}
     ORDER BY cantidad DESC, valor ASC
  `);

  return (filas as unknown as { valor: string; cantidad: number }[]).map((row) => ({
    valor: String(row.valor),
    cantidad: Number(row.cantidad),
  }));
}

/** Nombres de las categorias que aparecen en una faceta, para poder mostrarlas. */
export async function categoryNames(ids: string[], db?: Database): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();

  const filas = await conn(db)
    .select({ id: schema.categories.id, name: schema.categories.name })
    .from(schema.categories);

  return new Map(filas.filter((f) => ids.includes(f.id)).map((f) => [f.id, f.name]));
}

/**
 * ⚠️ Las facetas de catalogo se ordenan por CANTIDAD y se recortan. Un desplegable
 * con 135 temporadas o 38 clubes no es un filtro, es una lista: se muestran los
 * mas frecuentes, que es lo que la gente busca.
 */
export const MAX_VALORES_POR_FACETA = 12;

export { eq };
