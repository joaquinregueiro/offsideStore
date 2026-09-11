import { getDatabase, schema, type Database } from '@offside/database';
import { and, count, desc, eq, gte, inArray, ne, sql, type SQL } from 'drizzle-orm';

import { TIPOS_QUE_BLOQUEAN_VENTA } from '../../trust/services/sanction-rules';

/**
 * Acceso a `listings` y a `categories` (ERD §9.1 y §8). Sin reglas de negocio.
 *
 * `categories` se lee desde aca a proposito: es una tabla de CATALOGO, no un
 * dominio propio —`tech-stack.md` §2 no lista un modulo `catalog`—, y hoy
 * `listings` es su unico consumidor.
 */

export type ListingRow = typeof schema.listings.$inferSelect;

const conn = (db?: Database): Database => db ?? getDatabase();

/**
 * El vendedor puede operar (SS-013), expresado en SQL.
 *
 * =============================================================================
 * ⚠️ ES EL MISMO PREDICADO QUE `canSell()` DE `sellers`, EN OTRO LENGUAJE
 * =============================================================================
 *
 * `canSell(sellerStatus, mpStatus)` decide `approved` + `connected`. Aca hace
 * falta la version SQL porque el filtro tiene que correr EN LA BASE: traerse el
 * catalogo entero a memoria para descartar despues no escala, y ademas rompe la
 * paginacion —el LIMIT se aplicaria antes de filtrar—.
 *
 * Es la misma duplicacion consciente que ya existe entre `isPurchasable()` y el
 * WHERE del catalogo, y se acota igual: **un solo lugar** por lenguaje y un test
 * que fija que los dos digan lo mismo. Si algun dia divergen, la vitrina ofrece
 * lo que la compra rechaza, que es exactamente el problema que esto cierra.
 *
 * ⚠️ `INNER JOIN` Y NO `LEFT JOIN`: quien nunca conecto Mercado Pago no tiene
 * fila en `mercadopago_accounts`, y tampoco puede vender. Con `LEFT JOIN`
 * habria que acordarse de descartar el NULL a mano; asi es imposible olvidarlo.
 * `mercadopago_accounts` tiene `UNIQUE(seller_id)` (ERD §7.3), asi que el join
 * no puede multiplicar filas.
 */
const VENDEDOR_OPERATIVO = [
  eq(schema.sellerProfiles.status, 'approved'),
  eq(schema.mercadopagoAccounts.status, 'connected'),
] as const;

/**
 * Los tipos de sancion que sacan a un vendedor de la vitrina, como lista SQL.
 *
 * Sale de `TIPOS_QUE_BLOQUEAN_VENTA` de `trust` —el UNICO lugar que decide
 * cuales bloquean— para que agregar un tipo alla lo agregue aca solo. El cast
 * a `sanction_type` es lo que permite comparar el parametro con la columna
 * enum.
 */
const TIPOS_BLOQUEANTES_SQL = sql.join(
  [...TIPOS_QUE_BLOQUEAN_VENTA].map((tipo) => sql`${tipo}::sanction_type`),
  sql`, `,
);

/**
 * El vendedor esta DISPONIBLE: ni de vacaciones ni sancionado.
 *
 * Dos predicados derivados mas, con la misma logica que la desconexion de
 * Mercado Pago: no tocan `listings.status`, y al vencer la fecha —o al
 * levantarse la sancion— las publicaciones vuelven solas.
 *
 *  - Vacaciones (`vacation.service.ts`): ausente MIENTRAS `now() <
 *    vacation_until`. `NULL` = no esta de vacaciones.
 *  - Sancion (`sanction-rules.ts`, `rige()` + `bloqueaVenta()`): `active`,
 *    con `starts_at` nulo o ya pasado, `ends_at` nulo o futuro, y de un tipo
 *    que bloquee. `suspension`/`expulsion` ya ponen `seller_profiles.status`
 *    en `suspended`/`expelled` —y `VENDEDOR_OPERATIVO` ya los saca—; esto
 *    cubre el dia en que una sancion bloqueante NO materialice el estado.
 *
 * ⚠️ `NOT EXISTS` y no un join: `sanctions` puede tener varias filas por
 * vendedor y un join multiplicaria las publicaciones.
 */
const VENDEDOR_DISPONIBLE = [
  sql`(${schema.sellerProfiles.vacationUntil} IS NULL OR ${schema.sellerProfiles.vacationUntil} <= now())`,
  sql`NOT EXISTS (
    SELECT 1
      FROM sanctions sa
     WHERE sa.seller_id = ${schema.sellerProfiles.id}
       AND sa.status = 'active'
       AND sa.type IN (${TIPOS_BLOQUEANTES_SQL})
       AND (sa.starts_at IS NULL OR sa.starts_at <= now())
       AND (sa.ends_at IS NULL OR sa.ends_at > now())
  )`,
] as const;

/**
 * Todo lo que hace falta para que una publicacion se vea y se pueda comprar:
 * la regla del ERD §9.1 sobre la publicacion + el vendedor operativo (SS-013)
 * + el vendedor disponible. Es el WHERE de la vitrina, de la ficha y de la
 * tienda del vendedor; la busqueda lo repite en SQL crudo.
 */
const VISIBLE_EN_VITRINA = [
  eq(schema.listings.status, 'active'),
  eq(schema.listings.moderationStatus, 'APPROVED'),
  gte(schema.listings.stock, 1),
  ...VENDEDOR_OPERATIVO,
  ...VENDEDOR_DISPONIBLE,
] as const;

/** Promocionada VIGENTE (delta §1): `promoted_until` en el futuro. */
const PROMOCIONADA = sql`(${schema.listings.promotedUntil} IS NOT NULL AND ${schema.listings.promotedUntil} > now())`;

/**
 * Orden de la vitrina.
 *
 * ⚠️ `NULL > now()` ES NULL, Y `DESC` PONE LOS NULL PRIMERO en PostgreSQL:
 * ordenar por `promoted_until > now() DESC` a secas pondria a las NO
 * promocionadas arriba. Por eso `PROMOCIONADA` chequea `IS NOT NULL` y el
 * resultado es siempre un booleano.
 */
function ordenDeVitrina(promotedFirst: boolean): SQL[] {
  return promotedFirst
    ? [sql`${PROMOCIONADA} DESC`, desc(schema.listings.createdAt)]
    : [desc(schema.listings.createdAt)];
}

export async function findById(id: string, db?: Database): Promise<ListingRow | undefined> {
  const [row] = await conn(db)
    .select()
    .from(schema.listings)
    .where(eq(schema.listings.id, id))
    .limit(1);

  return row;
}

/** Titulos de varias publicaciones, para el historial de promociones. */
export async function findTitlesByIds(ids: string[], db?: Database): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();

  const filas = await conn(db)
    .select({ id: schema.listings.id, title: schema.listings.title })
    .from(schema.listings)
    .where(inArray(schema.listings.id, ids));

  return new Map(filas.map((fila) => [fila.id, fila.title]));
}

/**
 * Descuenta stock de forma ATOMICA (MF-022 / BR-022, anti-overselling).
 *
 * Devuelve el stock resultante, o `undefined` si no habia suficiente y **no se
 * descontó nada**.
 *
 * ⚠️ LA CONDICION `stock >= cantidad` VA EN EL `WHERE`, NO EN UN `if` PREVIO.
 * Leer y despues escribir deja una ventana entre las dos operaciones: dos pagos
 * simultaneos de la ultima unidad leerian `stock = 1` y ambos escribirian
 * `stock = 0`, vendiendo dos veces lo mismo. Con la condicion adentro del
 * UPDATE, PostgreSQL bloquea la fila y **reevalua el WHERE** contra la version
 * ya actualizada, asi que el segundo no encuentra fila y no descuenta.
 *
 * El `CHECK (stock >= 0)` de la tabla es la ultima red, no el control.
 */
export async function decrementStock(
  listingId: string,
  quantity: number,
  db?: Database,
): Promise<number | undefined> {
  const [row] = await conn(db)
    .update(schema.listings)
    .set({
      stock: sql`${schema.listings.stock} - ${quantity}`,
      updatedAt: new Date(),
    })
    .where(and(eq(schema.listings.id, listingId), gte(schema.listings.stock, quantity)))
    .returning({ stock: schema.listings.stock });

  return row?.stock;
}

export type CategoryRow = typeof schema.categories.$inferSelect;

/** Categoria del catalogo, para validar la publicacion. */
export async function findCategoryById(
  id: string,
  db?: Database,
): Promise<CategoryRow | undefined> {
  const [row] = await conn(db)
    .select()
    .from(schema.categories)
    .where(eq(schema.categories.id, id))
    .limit(1);

  return row;
}

/**
 * Categorias activas del catalogo.
 *
 * Es un conjunto fijo de seis filas respaldado por el enum `garment_category`
 * (database-design.md §5), asi que no se pagina ni se filtra.
 */
export async function findActiveCategories(db?: Database): Promise<CategoryRow[]> {
  return conn(db)
    .select()
    .from(schema.categories)
    .where(eq(schema.categories.isActive, true))
    .orderBy(schema.categories.name);
}

/** Publicaciones de un vendedor, sin las borradas. */
/**
 * ⚠️ EL `ORDER BY` NO ES COSMETICO. Sin el, PostgreSQL reordena las filas
 * despues de un UPDATE: pausar una publicacion la movia de lugar en el
 * inventario del vendedor, y la lista parecia barajarse sola.
 */
export async function findBySellerId(sellerId: string, db?: Database): Promise<ListingRow[]> {
  return conn(db)
    .select()
    .from(schema.listings)
    .where(and(eq(schema.listings.sellerId, sellerId), ne(schema.listings.status, 'deleted')))
    .orderBy(desc(schema.listings.createdAt));
}

/**
 * Cuantas publicaciones tiene un vendedor, por estado.
 *
 * ⚠️ ES UN `COUNT`, NO UN `SELECT *` CONTADO EN MEMORIA. El panel necesita el
 * numero, no las filas: traer el inventario entero para mostrar "12 activas"
 * seria pedirle a la base todo el catalogo de alguien en cada visita al panel.
 */
export async function countBySellerId(
  sellerId: string,
  db?: Database,
): Promise<{ status: ListingRow['status']; cantidad: number }[]> {
  const filas = await conn(db)
    .select({ status: schema.listings.status, cantidad: count() })
    .from(schema.listings)
    .where(and(eq(schema.listings.sellerId, sellerId), ne(schema.listings.status, 'deleted')))
    .groupBy(schema.listings.status);

  return filas.map((fila) => ({ status: fila.status, cantidad: Number(fila.cantidad) }));
}

export interface InsertListingValues {
  /** Referencias de catalogo (ERD §8). Opcionales: alimentan las facetas. */
  clubId?: string | null;
  nationalTeamId?: string | null;
  brandId?: string | null;
  competitionId?: string | null;
  seasonId?: string | null;
  sellerId: string;
  categoryId: string;
  title: string;
  description: string | null;
  priceAmount: bigint;
  currency: string;
  stock: number;
  sizeValue: string;
  condition: ListingRow['condition'];
  kitType: ListingRow['kitType'];
  sleeve: ListingRow['sleeve'];
  moderationStatus: ListingRow['moderationStatus'];
  /** Envio declarado (delta §11), ya validado por el Service. */
  shippingMode: string;
  shippingCostAmount: bigint | null;
}

/**
 * Crea la publicacion.
 *
 * ⚠️ `moderation_status` queda en su default `PENDING` y es **independiente** de
 * `status` (ERD §9.1). Quien modera y si un `PENDING` debe frenar la venta
 * siguen 🟡 sin decidir: no se toca desde aca.
 *
 * ⚠️ `authenticity` queda en su default `NO_ESPECIFICADA`: la evidencia exigida
 * por categoria sigue 🟦 (DEC-025).
 */
export async function insertListing(
  values: InsertListingValues,
  db?: Database,
): Promise<ListingRow> {
  const [row] = await conn(db)
    .insert(schema.listings)
    .values({
      sellerId: values.sellerId,
      categoryId: values.categoryId,
      title: values.title,
      description: values.description,
      priceAmount: values.priceAmount,
      currency: values.currency,
      stock: values.stock,
      sizeValue: values.sizeValue,
      condition: values.condition,
      kitType: values.kitType,
      sleeve: values.sleeve,
      clubId: values.clubId ?? null,
      nationalTeamId: values.nationalTeamId ?? null,
      brandId: values.brandId ?? null,
      competitionId: values.competitionId ?? null,
      seasonId: values.seasonId ?? null,
      shippingMode: values.shippingMode,
      shippingCostAmount: values.shippingCostAmount,
      /**
       * ⚠️ NACE EN BORRADOR (SS-032, y es el default del ERD §9.1).
       *
       * Antes nacia `active` porque las fotos no existian. Con PS-010 —"al
       * menos 1 foto obligatoria"— eso ya no se puede: la publicacion tiene que
       * existir ANTES que sus fotos, porque `listing_images.listing_id` es una
       * FK. Validar "tiene una foto" en el insert es literalmente imposible.
       *
       * El borrador resuelve el orden: se crea, se le cuelgan las fotos, y
       * recien ahi se activa. Una publicacion sin fotos se queda en borrador y
       * NO aparece en la vitrina, que es exactamente lo que PS-010 quiere.
       */
      status: 'draft',
      // Lo decide el Service, no el repositorio: es politica de moderacion.
      moderationStatus: values.moderationStatus,
    })
    .returning();

  return row!;
}

/** Una publicacion del catalogo, con lo que la vitrina necesita mostrar. */
export interface CatalogListingRow {
  id: string;
  title: string;
  priceAmount: bigint;
  currency: string;
  sizeValue: string;
  condition: ListingRow['condition'];
  stock: number;
  createdAt: Date;
  /** Nombre de tienda del vendedor. La vitrina lo muestra en la ficha. */
  sellerDisplayName: string;
  /** Para el distintivo de promocionada: el Service deriva `isPromoted`. */
  promotedUntil: Date | null;
  /** Envio declarado (delta §11). */
  shippingMode: string;
  shippingCostAmount: bigint | null;
}

/** Las columnas de una fila de catalogo. Se comparten entre vitrina y tienda. */
const COLUMNAS_DE_CATALOGO = {
  id: schema.listings.id,
  title: schema.listings.title,
  priceAmount: schema.listings.priceAmount,
  currency: schema.listings.currency,
  sizeValue: schema.listings.sizeValue,
  condition: schema.listings.condition,
  stock: schema.listings.stock,
  createdAt: schema.listings.createdAt,
  sellerDisplayName: schema.sellerProfiles.displayName,
  promotedUntil: schema.listings.promotedUntil,
  shippingMode: schema.listings.shippingMode,
  shippingCostAmount: schema.listings.shippingCostAmount,
} as const;

/**
 * Cambia el estado de una publicacion.
 *
 * ⚠️ LA CONDICION DE ORIGEN VA EN EL WHERE, no en una lectura previa. Asi la
 * transicion es ATOMICA: dos peticiones simultaneas no pueden activar dos veces
 * la misma publicacion. Devuelve `false` si la fila ya no estaba en el estado
 * esperado, y quien llama decide que significa.
 */
export async function transitionStatus(
  id: string,
  desde: ListingRow['status'],
  hacia: ListingRow['status'],
  db?: Database,
): Promise<boolean> {
  const filas = await conn(db)
    .update(schema.listings)
    .set({ status: hacia, updatedAt: new Date() })
    .where(and(eq(schema.listings.id, id), eq(schema.listings.status, desde)))
    .returning({ id: schema.listings.id });

  return filas.length === 1;
}

export interface UpdateListingValues {
  clubId?: string | null;
  nationalTeamId?: string | null;
  brandId?: string | null;
  competitionId?: string | null;
  seasonId?: string | null;
  title?: string;
  description?: string | null;
  priceAmount?: bigint;
  stock?: number;
  sizeValue?: string;
  condition?: ListingRow['condition'];
  kitType?: ListingRow['kitType'];
  sleeve?: ListingRow['sleeve'];
  categoryId?: string;
  status?: ListingRow['status'];
  /** Envio declarado, ya validado por el Service. Van juntos o no van. */
  shippingMode?: string;
  shippingCostAmount?: bigint | null;
}

/** Actualiza una publicacion. Solo los campos presentes. */
export async function updateListing(
  id: string,
  values: UpdateListingValues,
  db?: Database,
): Promise<ListingRow | undefined> {
  const [row] = await conn(db)
    .update(schema.listings)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(schema.listings.id, id))
    .returning();

  return row;
}

/**
 * Registra un cambio de precio (ERD §9.3, BR-015).
 *
 * ⚠️ NO ES OPCIONAL NI DECORATIVO. BR-015 es un MUST: los cambios sensibles
 * quedan auditados. El precio ademas tiene su propia tabla porque su historia
 * se consulta como serie —cuanto costaba esto antes—, cosa que `audit_log` no
 * responde bien.
 *
 * ⚠️ NO afecta a las ordenes ya creadas (BR-023): cada orden congelo su
 * importe en el snapshot al crearse y nunca vuelve a leer el precio.
 */
export async function insertPriceChange(
  values: {
    listingId: string;
    oldPriceAmount: bigint;
    newPriceAmount: bigint;
    currency: string;
    changedBy: string;
  },
  db?: Database,
): Promise<void> {
  await conn(db).insert(schema.listingPriceHistory).values(values);
}

export type PriceChangeRow = typeof schema.listingPriceHistory.$inferSelect;

/**
 * El ULTIMO cambio de precio de una publicacion desde `since`, si hubo uno.
 *
 * El ultimo y no "la ultima bajada": si bajo de 100 a 80 y despues subio a
 * 90, decir "antes $100" seria vender una rebaja que ya no existe. Quien llama
 * mira si ese ultimo cambio fue hacia abajo.
 */
export async function findLastPriceChange(
  listingId: string,
  since: Date,
  db?: Database,
): Promise<PriceChangeRow | undefined> {
  const [row] = await conn(db)
    .select()
    .from(schema.listingPriceHistory)
    .where(
      and(
        eq(schema.listingPriceHistory.listingId, listingId),
        gte(schema.listingPriceHistory.createdAt, since),
      ),
    )
    .orderBy(desc(schema.listingPriceHistory.createdAt))
    .limit(1);

  return row;
}

/**
 * Catalogo publico: lo que cualquiera puede ver y comprar.
 *
 * ⚠️ EL FILTRO ES LA REGLA DEL ERD §9.1, no una eleccion de presentacion:
 * `status='active'` Y `moderation_status='APPROVED'` Y `stock >= 1`. Es el
 * mismo predicado que `isPurchasable`, pero expresado en SQL porque filtrar en
 * memoria exigiria traer la tabla entera.
 *
 * ⚠️ NO EXPONE al vendedor mas que su nombre de tienda: ni su id de usuario, ni
 * su estado, ni datos fiscales.
 *
 * ⚠️ TAMBIEN EXIGE QUE EL VENDEDOR PUEDA OPERAR (SS-013 / UC-SS-4) Y ESTE
 * DISPONIBLE (vacaciones, sanciones). Antes no lo hacia, y el resultado era
 * una vitrina que prometia lo que la compra rechaza: el comprador entraba,
 * completaba la direccion y recien ahi chocaba contra un `409
 * SELLER_NOT_OPERATIONAL`. La documentacion es explicita —"pausa la venta
 * hasta reconectar"—, asi que esto no elige una politica: la cumple.
 *
 * `promotedFirst` pone las promocionadas vigentes ANTES que el resto (PS-021
 * "destacadas", `promoted_first_in_search` ⚙️); `soloPromocionadas` reduce
 * el catalogo a ellas, para la seccion "Promocionadas" de la home.
 */
export async function findPublicCatalog(
  opciones: { limite?: number; promotedFirst?: boolean; soloPromocionadas?: boolean } = {},
  db?: Database,
): Promise<CatalogListingRow[]> {
  return conn(db)
    .select(COLUMNAS_DE_CATALOGO)
    .from(schema.listings)
    .innerJoin(schema.sellerProfiles, eq(schema.listings.sellerId, schema.sellerProfiles.id))
    .innerJoin(
      schema.mercadopagoAccounts,
      eq(schema.mercadopagoAccounts.sellerId, schema.sellerProfiles.id),
    )
    .where(
      and(...VISIBLE_EN_VITRINA, ...(opciones.soloPromocionadas === true ? [PROMOCIONADA] : [])),
    )
    .orderBy(...ordenDeVitrina(opciones.promotedFirst === true))
    .limit(opciones.limite ?? 60);
}

/**
 * Las publicaciones VISIBLES de un vendedor, paginadas: la tienda publica
 * (SS-020, `/tienda/[username]`). Mismo filtro que la vitrina, asi que un
 * vendedor de vacaciones tiene la tienda vacia, no escondida.
 */
export async function findPublicBySellerId(
  sellerId: string,
  opciones: { limite: number; offset: number; promotedFirst?: boolean },
  db?: Database,
): Promise<CatalogListingRow[]> {
  return conn(db)
    .select(COLUMNAS_DE_CATALOGO)
    .from(schema.listings)
    .innerJoin(schema.sellerProfiles, eq(schema.listings.sellerId, schema.sellerProfiles.id))
    .innerJoin(
      schema.mercadopagoAccounts,
      eq(schema.mercadopagoAccounts.sellerId, schema.sellerProfiles.id),
    )
    .where(and(eq(schema.listings.sellerId, sellerId), ...VISIBLE_EN_VITRINA))
    .orderBy(...ordenDeVitrina(opciones.promotedFirst === true))
    .limit(opciones.limite)
    .offset(opciones.offset);
}

/** Cuantas publicaciones visibles tiene un vendedor, para paginar su tienda. */
export async function countPublicBySellerId(sellerId: string, db?: Database): Promise<number> {
  const [fila] = await conn(db)
    .select({ total: count() })
    .from(schema.listings)
    .innerJoin(schema.sellerProfiles, eq(schema.listings.sellerId, schema.sellerProfiles.id))
    .innerJoin(
      schema.mercadopagoAccounts,
      eq(schema.mercadopagoAccounts.sellerId, schema.sellerProfiles.id),
    )
    .where(and(eq(schema.listings.sellerId, sellerId), ...VISIBLE_EN_VITRINA));

  return Number(fila?.total ?? 0);
}

/** Una publicacion vista en su ficha, con los datos del vendedor que se exponen. */
export interface PublicListingDetailRow extends CatalogListingRow {
  description: string | null;
  kitType: ListingRow['kitType'];
  sleeve: ListingRow['sleeve'];
  authenticity: ListingRow['authenticity'];
  sellerId: string;
  /** `users.username`, para enlazar a `/tienda/[username]`. Puede no tener. */
  sellerUsername: string | null;
}

/**
 * Una publicacion del catalogo publico, por id.
 *
 * ⚠️ APLICA EL MISMO FILTRO QUE EL CATALOGO (ERD §9.1 + SS-013 + vacaciones y
 * sanciones). Devolver una publicacion pausada, agotada, sin aprobar o de un
 * vendedor que no puede operar solo porque alguien tiene su enlace seria una
 * via lateral para ver —y desde ahi intentar comprar— lo que la vitrina
 * esconde. Se devuelve `undefined` y la pagina responde 404.
 *
 * Esto importa mas de lo que parece: el enlace de una publicacion se comparte
 * por WhatsApp y sobrevive al catalogo. Sin este filtro, esos enlaces seguirian
 * llevando a una compra imposible mucho despues de la desconexion.
 */
export async function findPublicById(
  id: string,
  db?: Database,
): Promise<PublicListingDetailRow | undefined> {
  const [row] = await conn(db)
    .select({
      ...COLUMNAS_DE_CATALOGO,
      description: schema.listings.description,
      kitType: schema.listings.kitType,
      sleeve: schema.listings.sleeve,
      authenticity: schema.listings.authenticity,
      sellerId: schema.listings.sellerId,
      sellerUsername: schema.users.username,
    })
    .from(schema.listings)
    .innerJoin(schema.sellerProfiles, eq(schema.listings.sellerId, schema.sellerProfiles.id))
    .innerJoin(schema.users, eq(schema.sellerProfiles.userId, schema.users.id))
    .innerJoin(
      schema.mercadopagoAccounts,
      eq(schema.mercadopagoAccounts.sellerId, schema.sellerProfiles.id),
    )
    .where(and(eq(schema.listings.id, id), ...VISIBLE_EN_VITRINA))
    .limit(1);

  return row;
}

/** Lo que hace falta del vendedor para decidir, en memoria, si puede vender. */
export interface SellerAvailabilityRow {
  status: (typeof schema.sellerProfiles.$inferSelect)['status'];
  /** `null` si nunca conecto Mercado Pago. */
  mpStatus: (typeof schema.mercadopagoAccounts.$inferSelect)['status'] | null;
  vacationUntil: Date | null;
  /** Hay una sancion VIGENTE de un tipo que bloquea la venta. */
  blockingSanction: boolean;
}

/**
 * Estado del vendedor para `isPurchasableNow()`: la version en memoria del
 * predicado de `VISIBLE_EN_VITRINA`. Consulta la MISMA subconsulta de
 * sanciones que el WHERE, asi que no puede decir otra cosa.
 *
 * `LEFT JOIN` aca y no `INNER`: un vendedor sin cuenta de Mercado Pago tiene
 * que devolver `mpStatus: null` para que `canSell()` lo rechace, no
 * desaparecer.
 */
export async function findSellerAvailability(
  sellerId: string,
  db?: Database,
): Promise<SellerAvailabilityRow | undefined> {
  const [row] = await conn(db)
    .select({
      status: schema.sellerProfiles.status,
      mpStatus: schema.mercadopagoAccounts.status,
      vacationUntil: schema.sellerProfiles.vacationUntil,
      blockingSanction: sql<boolean>`NOT (${VENDEDOR_DISPONIBLE[1]})`,
    })
    .from(schema.sellerProfiles)
    .leftJoin(
      schema.mercadopagoAccounts,
      eq(schema.mercadopagoAccounts.sellerId, schema.sellerProfiles.id),
    )
    .where(eq(schema.sellerProfiles.id, sellerId))
    .limit(1);

  return row;
}

/**
 * Reclama la promocion de una publicacion: proyecta `promoted_until` SOLO si
 * no habia una vigente y la publicacion sigue `active`.
 *
 * ⚠️ ES LO QUE HACE ATOMICO A `promoteListing`. Dos clics simultaneos leerian
 * los dos "no esta promocionada" e insertarian dos filas de historial; con la
 * condicion en el WHERE, PostgreSQL bloquea la fila y el segundo no encuentra
 * nada que actualizar. Devuelve `false` en ese caso y el Service aborta la
 * transaccion ANTES de insertar el historial.
 */
export async function claimPromotion(
  listingId: string,
  promotedUntil: Date,
  at: Date,
  db?: Database,
): Promise<boolean> {
  const filas = await conn(db)
    .update(schema.listings)
    .set({ promotedUntil, promotedAt: at, updatedAt: at })
    .where(
      and(
        eq(schema.listings.id, listingId),
        eq(schema.listings.status, 'active'),
        sql`(${schema.listings.promotedUntil} IS NULL OR ${schema.listings.promotedUntil} <= ${at})`,
      ),
    )
    .returning({ id: schema.listings.id });

  return filas.length === 1;
}
