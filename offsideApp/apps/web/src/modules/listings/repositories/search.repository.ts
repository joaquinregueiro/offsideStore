import { getDatabase, schema, type Database } from '@offside/database';
import { eq, sql } from 'drizzle-orm';

import { TIPOS_QUE_BLOQUEAN_VENTA } from '../../trust/services/sanction-rules';

/**
 * Busqueda de publicaciones (PS-020 … PS-023, DEC-042).
 *
 * ⚠️ ES SQL CRUDO A PROPOSITO. Drizzle no expresa `tsquery`, `ts_rank` ni
 * `similarity`, y forzarlo con su API produciria algo menos legible que el SQL
 * que realmente corre. Todo parametro del usuario va **parametrizado**, nunca
 * interpolado: `sql` de Drizzle produce placeholders, no concatenacion.
 *
 * ⚠️ EL FILTRO DE VISIBILIDAD ES EL MISMO QUE EL DE LA VITRINA (ERD §9.1 +
 * SS-013 + vacaciones y sanciones): `status = 'active'`, `moderation_status =
 * 'APPROVED'`, `stock >= 1`, **el vendedor puede operar** y **esta
 * disponible**. Si la busqueda mostrara algo que la compra rechaza,
 * prometeria lo que no cumple.
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

/**
 * Los ordenes que el SQL sabe producir (PS-021). UNICA fuente: el Service los
 * re-exporta desde `services/search-query.ts`, asi que no pueden divergir.
 *
 * `popularidad` NO esta: no hay metricas de visitas ni de ventas por
 * publicacion. `reputacion` ordena por `seller_reputations.score`, que es una
 * proyeccion derivada (DEC-036) y puede no existir todavia para un vendedor:
 * esos van al final (`NULLS LAST`), no afuera.
 */
export const SEARCH_ORDERS = [
  'relevancia',
  'recientes',
  'precio_asc',
  'precio_desc',
  'reputacion',
] as const;

export type SearchOrder = (typeof SEARCH_ORDERS)[number];

export interface SearchRow {
  id: string;
  title: string;
  priceAmount: bigint;
  currency: string;
  sizeValue: string;
  condition: string;
  /** Unidades restantes. La grilla marca "Última unidad" con esto. */
  stock: number;
  sellerDisplayName: string;
  rank: number;
  /** Para el distintivo de promocionada. */
  promotedUntil: Date | null;
  /** Envio declarado (delta §11). */
  shippingMode: string;
  shippingCostAmount: bigint | null;
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

/** Los tipos de sancion que bloquean la venta, como lista SQL (ver `listing.repository.ts`). */
const TIPOS_BLOQUEANTES_SQL = sql.join(
  [...TIPOS_QUE_BLOQUEAN_VENTA].map((tipo) => sql`${tipo}::sanction_type`),
  sql`, `,
);

/**
 * El vendedor puede operar (SS-013) Y esta disponible (vacaciones, sanciones),
 * expresado en SQL.
 *
 * ⚠️ ES UN `EXISTS` Y NO UN JOIN A PROPOSITO. Esta condicion la usan los
 * cuatro caminos —resultados, conteo total, cotas de precio y CADA faceta—, y
 * tres de ellos consultan `FROM listings l` a secas. Con un join habria que
 * agregarlo en cada lugar y acordarse de sumarlo a cada faceta nueva; dentro
 * de `condiciones()` entra solo. Ademas un `EXISTS` no puede multiplicar
 * filas, asi que los conteos de las facetas siguen siendo exactos.
 *
 * Si las facetas no lo aplicaran, dirian "River Plate (3)" y la busqueda
 * devolveria dos: un filtro que miente sobre lo que hay.
 *
 * Es el MISMO predicado que `VISIBLE_EN_VITRINA` en `listing.repository.ts`
 * (Drizzle) y que `isPurchasableNow()` (memoria): un lugar por lenguaje, y
 * un test de integracion que fija que digan lo mismo.
 */
const VENDEDOR_OPERATIVO = sql`EXISTS (
  SELECT 1
    FROM seller_profiles sp
    JOIN mercadopago_accounts mp ON mp.seller_id = sp.id
   WHERE sp.id = l.seller_id
     AND sp.status = 'approved'
     AND mp.status = 'connected'
     AND (sp.vacation_until IS NULL OR sp.vacation_until <= now())
     AND NOT EXISTS (
       SELECT 1
         FROM sanctions sa
        WHERE sa.seller_id = sp.id
          AND sa.status = 'active'
          AND sa.type IN (${TIPOS_BLOQUEANTES_SQL})
          AND (sa.starts_at IS NULL OR sa.starts_at <= now())
          AND (sa.ends_at IS NULL OR sa.ends_at > now())
     )
)`;

/** Promocionada VIGENTE. Siempre booleano: ver `ordenDeVitrina` en `listing.repository.ts`. */
const PROMOCIONADA = sql`(l.promoted_until IS NOT NULL AND l.promoted_until > now())`;

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

/** WHERE completo: visibilidad + filtros (+ texto si hay). */
function where(input: Pick<SearchInput, 'texto' | 'filtros'>) {
  return input.texto === undefined
    ? condiciones(input.filtros)
    : sql`${condiciones(input.filtros)} AND ${coincideTexto(input.texto)}`;
}

export interface SearchInput {
  texto?: string;
  filtros: SearchFilters;
  orden: SearchOrder;
  /** Pesos {D,C,B,A} del Config Store (PS-021 / DEC-042). */
  pesos: number[];
  /**
   * Sumando al ranking de una promocionada vigente (`promotion_rank_boost`
   * ⚙️). `0` = las promocionadas no reciben ningun empujon en relevancia.
   */
  promotionRankBoost: number;
  /** Promocionadas ANTES que el resto, en cualquier orden (`promoted_first_in_search` ⚙️). */
  promotedFirst: boolean;
  limite: number;
  offset: number;
}

export async function search(input: SearchInput, db?: Database): Promise<SearchRow[]> {
  // El ranking de TEXTO sólo tiene sentido si hay texto; sin él, `ts_rank`
  // daria 0 para todo. El boost de promocion se suma en los dos casos: sin
  // texto es lo unico que ordena por "relevancia", y es exactamente lo que
  // PS-021 llama "destacadas".
  const rankDeTexto =
    input.texto === undefined
      ? sql`0::float4`
      : sql`ts_rank(
            ${sql.raw(`ARRAY[${input.pesos.map((p) => Number(p)).join(',')}]::float4[]`)},
            l.search_vector,
            websearch_to_tsquery('spanish', unaccent(${input.texto}))
          )`;

  const boost = Number(input.promotionRankBoost);
  const rank =
    boost > 0
      ? sql`(${rankDeTexto} + CASE WHEN ${PROMOCIONADA} THEN ${sql.raw(String(boost))}::float4 ELSE 0::float4 END)`
      : rankDeTexto;

  const ordenPropio =
    input.orden === 'precio_asc'
      ? sql`l.price_amount ASC, l.created_at DESC`
      : input.orden === 'precio_desc'
        ? sql`l.price_amount DESC, l.created_at DESC`
        : input.orden === 'recientes'
          ? sql`l.created_at DESC`
          : input.orden === 'reputacion'
            ? // `seller_reputations.score` es un cache derivado (DEC-036) y
              // puede no existir todavia para un vendedor nuevo: va al final,
              // no afuera.
              sql`r.score DESC NULLS LAST, l.created_at DESC`
            : // Relevancia. El desempate por fecha evita que dos publicaciones con
              // el mismo rank salgan en orden distinto en cada consulta.
              sql`rank DESC, l.created_at DESC`;

  // "Promocionadas primero" es un PREFIJO del orden elegido, no otro orden:
  // dentro de cada grupo (promocionadas / resto) se respeta lo que pidio la
  // persona. Sin esto, elegir "precio ascendente" borraria el destacado.
  const orden = input.promotedFirst ? sql`${PROMOCIONADA} DESC, ${ordenPropio}` : ordenPropio;

  const filas = await conn(db).execute(sql`
    SELECT l.id, l.title, l.price_amount, l.currency, l.size_value, l.condition, l.stock,
           l.promoted_until, l.shipping_mode, l.shipping_cost_amount,
           s.display_name AS seller_display_name,
           ${rank} AS rank
      FROM listings l
      JOIN seller_profiles s ON s.id = l.seller_id
      LEFT JOIN seller_reputations r ON r.seller_id = l.seller_id
     WHERE ${where(input)}
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
    stock: Number(row.stock),
    sellerDisplayName: String(row.seller_display_name),
    rank: Number(row.rank),
    promotedUntil: comoFecha(row.promoted_until),
    shippingMode: String(row.shipping_mode),
    shippingCostAmount: comoCentavos(row.shipping_cost_amount),
  }));
}

/**
 * Texto de una columna cruda de una consulta `sql``…```.
 *
 * ⚠️ EXISTE PORQUE `String(unknown)` ES UNA TRAMPA: si el driver devolviera un
 * objeto, `String()` produce `"[object Object]"` sin avisar y ese texto termina
 * en un `BigInt()` o en un `new Date()` que fallan lejos de la causa. Acá se
 * aceptan solo los tipos que un driver puede devolver para estas columnas y
 * cualquier otra cosa es `null`, que los llamadores ya saben manejar.
 */
function comoTexto(valor: unknown): string | null {
  if (typeof valor === 'string') return valor;
  if (typeof valor === 'number' || typeof valor === 'bigint') return String(valor);

  return null;
}

/**
 * `timestamptz` crudo → `Date`. postgres-js ya devuelve `Date` para esa
 * columna; el `string` cubre un driver que la devuelva sin parsear.
 */
function comoFecha(valor: unknown): Date | null {
  if (valor === null || valor === undefined) return null;
  if (valor instanceof Date) return valor;

  const texto = comoTexto(valor);
  if (texto === null) return null;

  const fecha = new Date(texto);

  return Number.isNaN(fecha.getTime()) ? null : fecha;
}

/** `bigint` crudo (centavos) → `bigint`. */
function comoCentavos(valor: unknown): bigint | null {
  if (typeof valor === 'bigint') return valor;

  const texto = comoTexto(valor);

  return texto === null ? null : BigInt(texto);
}

/** Cuantos resultados hay en total, para paginar y para mostrar el numero. */
export async function countResults(
  input: Pick<SearchInput, 'texto' | 'filtros'>,
  db?: Database,
): Promise<number> {
  const filas = await conn(db).execute(sql`
    SELECT count(*)::int AS total FROM listings l WHERE ${where(input)}
  `);

  return Number((filas as unknown as { total: number }[])[0]?.total ?? 0);
}

export interface PriceBounds {
  /** Centavos. `null` cuando no hay resultados. */
  minimo: bigint | null;
  maximo: bigint | null;
}

/**
 * Precio minimo y maximo DEL RESULTADO (con texto y filtros aplicados, incluido
 * el propio rango de precio). Es lo que le permite a la pantalla dibujar el
 * control de precio con limites reales en vez de un campo vacio.
 */
export async function priceBounds(
  input: Pick<SearchInput, 'texto' | 'filtros'>,
  db?: Database,
): Promise<PriceBounds> {
  const filas = await conn(db).execute(sql`
    SELECT min(l.price_amount) AS minimo, max(l.price_amount) AS maximo
      FROM listings l
     WHERE ${where(input)}
  `);

  const fila = (filas as unknown as { minimo: unknown; maximo: unknown }[])[0];
  return { minimo: comoCentavos(fila?.minimo), maximo: comoCentavos(fila?.maximo) };
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

  const base = where({
    ...(input.texto === undefined ? {} : { texto: input.texto }),
    filtros: resto,
  });

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
