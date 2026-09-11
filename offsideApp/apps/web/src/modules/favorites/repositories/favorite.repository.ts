import { getDatabase, schema, type Database } from '@offside/database';
import { and, count, desc, eq, inArray, isNull, sql } from 'drizzle-orm';

/**
 * Acceso a `favorites` (ERD §10). Sin reglas de negocio.
 *
 * `UNIQUE(user_id, listing_id)` es lo que vuelve idempotente al toggle: no hay
 * forma de tener dos veces la misma publicacion en favoritos.
 */

export type FavoriteRow = typeof schema.favorites.$inferSelect;

const conn = (db?: Database): Database => db ?? getDatabase();

export async function find(
  userId: string,
  listingId: string,
  db?: Database,
): Promise<FavoriteRow | undefined> {
  const [row] = await conn(db)
    .select()
    .from(schema.favorites)
    .where(and(eq(schema.favorites.userId, userId), eq(schema.favorites.listingId, listingId)))
    .limit(1);

  return row;
}

/**
 * Agrega a favoritos. Si ya estaba, no hace nada y devuelve `false`.
 *
 * `ON CONFLICT DO NOTHING` en vez de leer-y-escribir: dos toques rapidos al
 * corazon no pueden terminar en un error de UNIQUE.
 */
export async function insert(userId: string, listingId: string, db?: Database): Promise<boolean> {
  const filas = await conn(db)
    .insert(schema.favorites)
    .values({ userId, listingId })
    .onConflictDoNothing({ target: [schema.favorites.userId, schema.favorites.listingId] })
    .returning({ id: schema.favorites.id });

  return filas.length === 1;
}

/** Saca de favoritos. Devuelve `false` si no estaba. */
export async function remove(userId: string, listingId: string, db?: Database): Promise<boolean> {
  const filas = await conn(db)
    .delete(schema.favorites)
    .where(and(eq(schema.favorites.userId, userId), eq(schema.favorites.listingId, listingId)))
    .returning({ id: schema.favorites.id });

  return filas.length === 1;
}

/** Cuanta gente tiene la publicacion en favoritos. */
export async function countByListingId(listingId: string, db?: Database): Promise<number> {
  const [fila] = await conn(db)
    .select({ cantidad: count() })
    .from(schema.favorites)
    .where(eq(schema.favorites.listingId, listingId));

  return Number(fila?.cantidad ?? 0);
}

export async function countByUserId(userId: string, db?: Database): Promise<number> {
  const [fila] = await conn(db)
    .select({ cantidad: count() })
    .from(schema.favorites)
    .where(eq(schema.favorites.userId, userId));

  return Number(fila?.cantidad ?? 0);
}

/** Quienes tienen la publicacion en favoritos. Para las alertas de precio. */
export async function findUserIdsByListingId(listingId: string, db?: Database): Promise<string[]> {
  const filas = await conn(db)
    .select({ userId: schema.favorites.userId })
    .from(schema.favorites)
    .where(eq(schema.favorites.listingId, listingId));

  return filas.map((f) => f.userId);
}

/** Un favorito con lo que la lista necesita mostrar de la publicacion. */
export interface FavoriteListingRow {
  listingId: string;
  favoritedAt: Date;
  title: string;
  priceAmount: bigint;
  currency: string;
  sizeValue: string;
  condition: typeof schema.listings.$inferSelect.condition;
  status: typeof schema.listings.$inferSelect.status;
  stock: number;
  sellerDisplayName: string;
  /**
   * Si HOY se puede comprar: ERD §9.1 (`active` + `APPROVED` + stock) y el
   * vendedor operativo (SS-013).
   *
   * ⚠️ ES EL MISMO PREDICADO QUE `findPublicCatalog` DE `listings`, EN SQL,
   * porque un favorito NO se filtra: una publicacion pausada o agotada sigue
   * en la lista —es lo que BS-051 quiere avisar— pero marcada como no
   * comprable. Se calcula en la base para que la pagina no tenga que traer las
   * cuentas de Mercado Pago de cada vendedor.
   */
  comprable: boolean;
  /**
   * Cuanto costaba la publicacion cuando se guardo, o `null` si no cambio de
   * precio desde entonces.
   *
   * ⚠️ `favorites` NO GUARDA EL PRECIO (ERD §10) y no se le invento una
   * columna: se DERIVA de `listing_price_history` (ERD §9.3), que
   * `listing-editing.service` escribe en cada cambio. El primer cambio
   * posterior a `favorited_at` lleva en `old_price_amount` el precio que
   * regia al guardar. Sin cambios posteriores, el precio de entonces es el de
   * ahora y no hay nada que comparar.
   */
  precioAlGuardar: bigint | null;
}

/**
 * Favoritos de un usuario, mas reciente primero, con su publicacion.
 *
 * `LEFT JOIN` a `mercadopago_accounts` y no `INNER`: quien nunca conecto no
 * tiene fila, y su publicacion tiene que aparecer igual (como no comprable).
 * `UNIQUE(seller_id)` en esa tabla garantiza que el join no multiplica filas.
 *
 * Las publicaciones ELIMINADAS no se listan: `deleted` es terminal y mostrar
 * una tarjeta a la que no se puede entrar no sirve.
 */
export async function findByUserIdWithListing(
  userId: string,
  opciones: { limite: number; offset: number },
  db?: Database,
): Promise<FavoriteListingRow[]> {
  return conn(db)
    .select({
      listingId: schema.favorites.listingId,
      favoritedAt: schema.favorites.createdAt,
      title: schema.listings.title,
      priceAmount: schema.listings.priceAmount,
      currency: schema.listings.currency,
      sizeValue: schema.listings.sizeValue,
      condition: schema.listings.condition,
      status: schema.listings.status,
      stock: schema.listings.stock,
      sellerDisplayName: schema.sellerProfiles.displayName,
      // `COALESCE`: con el LEFT JOIN, un vendedor sin cuenta de Mercado Pago
      // deja `mp.status` en NULL y `NULL = 'connected'` es NULL, no false.
      // Sin esto la pagina recibiria un tercer valor que no es booleano.
      comprable: sql<boolean>`COALESCE((
        ${schema.listings.status} = 'active'
        AND ${schema.listings.moderationStatus} = 'APPROVED'
        AND ${schema.listings.stock} >= 1
        AND ${schema.sellerProfiles.status} = 'approved'
        AND ${schema.mercadopagoAccounts.status} = 'connected'
      ), false)`,
      precioAlGuardar: sql<bigint | null>`(
        SELECT h.old_price_amount
          FROM listing_price_history h
         WHERE h.listing_id = ${schema.listings.id}
           AND h.created_at > ${schema.favorites.createdAt}
         ORDER BY h.created_at ASC, h.id ASC
         LIMIT 1
      )`,
    })
    .from(schema.favorites)
    .innerJoin(schema.listings, eq(schema.favorites.listingId, schema.listings.id))
    .innerJoin(schema.sellerProfiles, eq(schema.listings.sellerId, schema.sellerProfiles.id))
    .leftJoin(
      schema.mercadopagoAccounts,
      eq(schema.mercadopagoAccounts.sellerId, schema.sellerProfiles.id),
    )
    .where(
      and(
        eq(schema.favorites.userId, userId),
        isNull(schema.listings.deletedAt),
        sql`${schema.listings.status} <> 'deleted'`,
      ),
    )
    .orderBy(desc(schema.favorites.createdAt), desc(schema.favorites.id))
    .limit(opciones.limite)
    .offset(opciones.offset);
}

/** Cuantos favoritos listables tiene el usuario (mismo filtro que la lista). */
export async function countListableByUserId(userId: string, db?: Database): Promise<number> {
  const [fila] = await conn(db)
    .select({ cantidad: count() })
    .from(schema.favorites)
    .innerJoin(schema.listings, eq(schema.favorites.listingId, schema.listings.id))
    .where(
      and(
        eq(schema.favorites.userId, userId),
        isNull(schema.listings.deletedAt),
        sql`${schema.listings.status} <> 'deleted'`,
      ),
    );

  return Number(fila?.cantidad ?? 0);
}

/**
 * De estas publicaciones, cuales tiene el usuario en favoritos.
 *
 * Es UNA consulta para toda la grilla —la vitrina pinta el corazon lleno o
 * vacio en cada tarjeta— y no una por tarjeta.
 */
export async function findListingIdsByUserId(
  userId: string,
  listingIds: string[],
  db?: Database,
): Promise<string[]> {
  if (listingIds.length === 0) return [];

  const filas = await conn(db)
    .select({ listingId: schema.favorites.listingId })
    .from(schema.favorites)
    .where(
      and(eq(schema.favorites.userId, userId), inArray(schema.favorites.listingId, listingIds)),
    );

  return filas.map((f) => f.listingId);
}

/**
 * Existencia de una publicacion NO eliminada, con el usuario dueño.
 *
 * Se lee `listings` directo y no via `listings.service.findById` porque hace
 * falta tambien el `user_id` del vendedor (para no dejar que alguien se
 * "favoritee" a si mismo... que no se prohibe, pero si se expone) y para no
 * cargar el Service entero de listings —que arrastra storage y busqueda— por
 * una comprobacion de existencia.
 */
export interface ListingOwnerRow {
  id: string;
  sellerUserId: string;
  status: string;
  title: string;
  priceAmount: bigint;
  currency: string;
}

export async function findListingOwner(
  listingId: string,
  db?: Database,
): Promise<ListingOwnerRow | undefined> {
  const [row] = await conn(db)
    .select({
      id: schema.listings.id,
      sellerUserId: schema.sellerProfiles.userId,
      status: schema.listings.status,
      title: schema.listings.title,
      priceAmount: schema.listings.priceAmount,
      currency: schema.listings.currency,
    })
    .from(schema.listings)
    .innerJoin(schema.sellerProfiles, eq(schema.listings.sellerId, schema.sellerProfiles.id))
    .where(and(eq(schema.listings.id, listingId), isNull(schema.listings.deletedAt)))
    .limit(1);

  return row;
}

/**
 * Valor vigente de una clave GLOBAL de `app_settings`.
 *
 * ⚠️ DUPLICA `app-setting.repository.findCurrent` DE `config`, y es a
 * proposito: un modulo no importa el repository de otro (`modules/README.md`)
 * y el Service de config solo expone la comision. Cuando exista
 * `settingsService.getSetting(key)`, esto se borra y se llama a eso.
 */
export async function findGlobalSetting(key: string, db?: Database): Promise<unknown> {
  const [row] = await conn(db)
    .select({ value: schema.appSettings.value })
    .from(schema.appSettings)
    .where(
      and(
        eq(schema.appSettings.scope, 'global'),
        isNull(schema.appSettings.scopeId),
        eq(schema.appSettings.key, key),
      ),
    )
    .orderBy(desc(schema.appSettings.version))
    .limit(1);

  return row?.value;
}
