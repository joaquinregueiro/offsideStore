import { getDatabase, schema, type Database } from '@offside/database';
import { and, asc, count, desc, eq, isNull, sql } from 'drizzle-orm';

/**
 * Acceso a `carts` y `cart_items` (ERD §10). Sin reglas de negocio.
 *
 * Un carrito por usuario (`UNIQUE(user_id)`) y una linea por publicacion
 * (`UNIQUE(cart_id, listing_id)`). El carrito NO reserva stock (MF-010).
 */

export type CartRow = typeof schema.carts.$inferSelect;
export type CartItemRow = typeof schema.cartItems.$inferSelect;

const conn = (db?: Database): Database => db ?? getDatabase();

export async function findCartByUserId(
  userId: string,
  db?: Database,
): Promise<CartRow | undefined> {
  const [row] = await conn(db)
    .select()
    .from(schema.carts)
    .where(eq(schema.carts.userId, userId))
    .limit(1);

  return row;
}

/**
 * El carrito del usuario, creandolo si no existe.
 *
 * `ON CONFLICT DO NOTHING` + lectura: dos "agregar" simultaneos del mismo
 * usuario sin carrito no pueden terminar en un error de UNIQUE.
 */
export async function findOrCreateCart(userId: string, db?: Database): Promise<CartRow> {
  const [creado] = await conn(db)
    .insert(schema.carts)
    .values({ userId })
    .onConflictDoNothing({ target: schema.carts.userId })
    .returning();

  if (creado !== undefined) return creado;

  const existente = await findCartByUserId(userId, db);
  if (existente === undefined) throw new Error(`No se pudo crear el carrito del usuario ${userId}`);

  return existente;
}

export async function findItem(
  cartId: string,
  listingId: string,
  db?: Database,
): Promise<CartItemRow | undefined> {
  const [row] = await conn(db)
    .select()
    .from(schema.cartItems)
    .where(and(eq(schema.cartItems.cartId, cartId), eq(schema.cartItems.listingId, listingId)))
    .limit(1);

  return row;
}

/** Una linea del carrito con lo que hace falta de la publicacion y del vendedor. */
export interface CartItemWithListingRow {
  itemId: string;
  listingId: string;
  quantity: number;
  unitPriceSnapshot: bigint;
  currency: string;
  addedAt: Date;
  title: string;
  priceAmount: bigint;
  listingCurrency: string;
  stock: number;
  status: typeof schema.listings.$inferSelect.status;
  moderationStatus: typeof schema.listings.$inferSelect.moderationStatus;
  listingDeletedAt: Date | null;
  /** Envio declarado por el vendedor (delta §11). */
  shippingMode: string;
  shippingCostAmount: bigint | null;
  /** Vigencia de la promocion: decide si la linea va en una orden propia. */
  promotedUntil: Date | null;
  sellerId: string;
  sellerUserId: string;
  sellerDisplayName: string;
  sellerStatus: typeof schema.sellerProfiles.$inferSelect.status;
  /** `null` si el vendedor nunca conecto Mercado Pago. */
  mpStatus: typeof schema.mercadopagoAccounts.$inferSelect.status | null;
}

/**
 * Lineas del carrito con su publicacion, agrupables por vendedor.
 *
 * Ordenadas por vendedor y despues por cuando se agregaron: el checkout crea
 * una orden por vendedor (DEC-026) y este orden es el que se le muestra.
 *
 * `LEFT JOIN` a `mercadopago_accounts`: quien nunca conecto no tiene fila, y
 * la linea tiene que aparecer igual (marcada como no comprable), no
 * desaparecer del carrito sin explicacion.
 */
export async function findItemsWithListing(
  cartId: string,
  db?: Database,
): Promise<CartItemWithListingRow[]> {
  return conn(db)
    .select({
      itemId: schema.cartItems.id,
      listingId: schema.cartItems.listingId,
      quantity: schema.cartItems.quantity,
      unitPriceSnapshot: schema.cartItems.unitPriceSnapshot,
      currency: schema.cartItems.currency,
      addedAt: schema.cartItems.createdAt,
      title: schema.listings.title,
      priceAmount: schema.listings.priceAmount,
      listingCurrency: schema.listings.currency,
      stock: schema.listings.stock,
      status: schema.listings.status,
      moderationStatus: schema.listings.moderationStatus,
      listingDeletedAt: schema.listings.deletedAt,
      shippingMode: schema.listings.shippingMode,
      shippingCostAmount: schema.listings.shippingCostAmount,
      promotedUntil: schema.listings.promotedUntil,
      sellerId: schema.listings.sellerId,
      sellerUserId: schema.sellerProfiles.userId,
      sellerDisplayName: schema.sellerProfiles.displayName,
      sellerStatus: schema.sellerProfiles.status,
      mpStatus: schema.mercadopagoAccounts.status,
    })
    .from(schema.cartItems)
    .innerJoin(schema.listings, eq(schema.cartItems.listingId, schema.listings.id))
    .innerJoin(schema.sellerProfiles, eq(schema.listings.sellerId, schema.sellerProfiles.id))
    .leftJoin(
      schema.mercadopagoAccounts,
      eq(schema.mercadopagoAccounts.sellerId, schema.sellerProfiles.id),
    )
    .where(eq(schema.cartItems.cartId, cartId))
    .orderBy(
      asc(schema.listings.sellerId),
      asc(schema.cartItems.createdAt),
      asc(schema.cartItems.id),
    );
}

/**
 * La publicacion sola, con la MISMA forma que una linea del carrito.
 *
 * ⚠️ EXISTE PARA NO DUPLICAR LAS REGLAS DE COMPRABILIDAD. Al agregar algo al
 * carrito hay que decidir si se puede comprar —publicacion activa, aprobada,
 * con stock, vendedor aprobado y con Mercado Pago conectado— y esa decision ya
 * esta escrita una sola vez sobre `CartItemWithListingRow`. Devolver la
 * publicacion con esa forma deja que la MISMA funcion decida antes y despues
 * de que la linea exista, en vez de escribir el predicado dos veces.
 *
 * Los campos de la linea (cantidad, precio congelado, fecha) los completa el
 * Service: todavia no hay linea.
 */
export type ListingAsCartRow = Omit<
  CartItemWithListingRow,
  'itemId' | 'quantity' | 'unitPriceSnapshot' | 'currency' | 'addedAt'
>;

export async function findListingAsCartRow(
  listingId: string,
  db?: Database,
): Promise<ListingAsCartRow | undefined> {
  const [row] = await conn(db)
    .select({
      listingId: schema.listings.id,
      title: schema.listings.title,
      priceAmount: schema.listings.priceAmount,
      listingCurrency: schema.listings.currency,
      stock: schema.listings.stock,
      status: schema.listings.status,
      moderationStatus: schema.listings.moderationStatus,
      listingDeletedAt: schema.listings.deletedAt,
      shippingMode: schema.listings.shippingMode,
      shippingCostAmount: schema.listings.shippingCostAmount,
      promotedUntil: schema.listings.promotedUntil,
      sellerId: schema.listings.sellerId,
      sellerUserId: schema.sellerProfiles.userId,
      sellerDisplayName: schema.sellerProfiles.displayName,
      sellerStatus: schema.sellerProfiles.status,
      mpStatus: schema.mercadopagoAccounts.status,
    })
    .from(schema.listings)
    .innerJoin(schema.sellerProfiles, eq(schema.listings.sellerId, schema.sellerProfiles.id))
    .leftJoin(
      schema.mercadopagoAccounts,
      eq(schema.mercadopagoAccounts.sellerId, schema.sellerProfiles.id),
    )
    .where(eq(schema.listings.id, listingId))
    .limit(1);

  return row;
}

export interface UpsertItemValues {
  cartId: string;
  listingId: string;
  quantity: number;
  unitPriceSnapshot: bigint;
  currency: string;
}

/**
 * Agrega la linea o, si ya estaba, le pone la cantidad indicada.
 *
 * ⚠️ EL SNAPSHOT DE PRECIO NO SE PISA EN EL CONFLICTO: es el precio que la
 * persona VIO al agregar la primera vez, y es lo que permite avisar "cambio
 * desde que lo agregaste". La cantidad si se reemplaza —el Service ya sumo
 * lo que habia—.
 */
export async function upsertItem(values: UpsertItemValues, db?: Database): Promise<CartItemRow> {
  const [row] = await conn(db)
    .insert(schema.cartItems)
    .values(values)
    .onConflictDoUpdate({
      target: [schema.cartItems.cartId, schema.cartItems.listingId],
      set: { quantity: values.quantity },
    })
    .returning();

  return row!;
}

export async function updateQuantity(
  cartId: string,
  listingId: string,
  quantity: number,
  db?: Database,
): Promise<CartItemRow | undefined> {
  const [row] = await conn(db)
    .update(schema.cartItems)
    .set({ quantity })
    .where(and(eq(schema.cartItems.cartId, cartId), eq(schema.cartItems.listingId, listingId)))
    .returning();

  return row;
}

export async function removeItem(
  cartId: string,
  listingId: string,
  db?: Database,
): Promise<boolean> {
  const filas = await conn(db)
    .delete(schema.cartItems)
    .where(and(eq(schema.cartItems.cartId, cartId), eq(schema.cartItems.listingId, listingId)))
    .returning({ id: schema.cartItems.id });

  return filas.length === 1;
}

export async function clearItems(cartId: string, db?: Database): Promise<number> {
  const filas = await conn(db)
    .delete(schema.cartItems)
    .where(eq(schema.cartItems.cartId, cartId))
    .returning({ id: schema.cartItems.id });

  return filas.length;
}

/** Cuantas LINEAS (publicaciones distintas) hay en el carrito. */
export async function countItems(cartId: string, db?: Database): Promise<number> {
  const [fila] = await conn(db)
    .select({ cantidad: count() })
    .from(schema.cartItems)
    .where(eq(schema.cartItems.cartId, cartId));

  return Number(fila?.cantidad ?? 0);
}

/** Sella `updated_at` del carrito. Solo trazabilidad. */
export async function touch(cartId: string, db?: Database): Promise<void> {
  await conn(db)
    .update(schema.carts)
    .set({ updatedAt: sql`now()` })
    .where(eq(schema.carts.id, cartId));
}

/**
 * Valor vigente de una clave GLOBAL de `app_settings`.
 *
 * ⚠️ DUPLICA `app-setting.repository.findCurrent` DE `config`, a proposito:
 * un modulo no importa el repository de otro (`modules/README.md`). Cuando
 * exista `settingsService.getSetting(key)`, esto se borra.
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
