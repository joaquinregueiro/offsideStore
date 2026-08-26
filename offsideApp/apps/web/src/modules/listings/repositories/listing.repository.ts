import { getDatabase, schema, type Database } from '@offside/database';
import { and, eq, gte, ne, sql } from 'drizzle-orm';

/**
 * Acceso a `listings` y a `categories` (ERD §9.1 y §8). Sin reglas de negocio.
 *
 * ⚠️ ALCANCE MINIMO. Del modulo `listings` estan publicar y listar; **faltan**
 * editar, pausar, moderar, imagenes, buscar e indexar.
 *
 * `categories` se lee desde aca a proposito: es una tabla de CATALOGO, no un
 * dominio propio —`tech-stack.md` §2 no lista un modulo `catalog`—, y hoy
 * `listings` es su unico consumidor.
 */

export type ListingRow = typeof schema.listings.$inferSelect;

const conn = (db?: Database): Database => db ?? getDatabase();

export async function findById(id: string, db?: Database): Promise<ListingRow | undefined> {
  const [row] = await conn(db)
    .select()
    .from(schema.listings)
    .where(eq(schema.listings.id, id))
    .limit(1);

  return row;
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

/** Publicaciones de un vendedor, sin las borradas. */
export async function findBySellerId(sellerId: string, db?: Database): Promise<ListingRow[]> {
  return conn(db)
    .select()
    .from(schema.listings)
    .where(and(eq(schema.listings.sellerId, sellerId), ne(schema.listings.status, 'deleted')));
}

export interface InsertListingValues {
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
      // El vendedor publica: nace visible. `draft` existe para guardar sin
      // publicar, que es otro flujo y no esta implementado.
      status: 'active',
    })
    .returning();

  return row!;
}
