import { getDatabase, schema, type Database } from '@offside/database';
import { and, desc, eq, gte, ne, sql } from 'drizzle-orm';

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
  moderationStatus: ListingRow['moderationStatus'];
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
}

/**
 * Catalogo publico: lo que cualquiera puede ver y comprar.
 *
 * ⚠️ EL FILTRO ES LA REGLA DEL ERD §9.1, no una eleccion de presentacion:
 * `status='active'` Y `moderation_status='APPROVED'` Y `stock >= 1`. Es el
 * mismo predicado que `isPurchasable`, pero expresado en SQL porque filtrar en
 * memoria exigiria traer la tabla entera.
 *
 * ⚠️ SIN BUSQUEDA NI FACETAS. DEC-042 define la busqueda full-text sobre
 * `search_vector`, que todavia no se puebla. Esto es un listado por fecha, y
 * cuando exista la busqueda la reemplaza.
 *
 * ⚠️ NO EXPONE al vendedor mas que su nombre de tienda: ni su id de usuario, ni
 * su estado, ni datos fiscales.
 */
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

export async function findPublicCatalog(
  opciones: { limite?: number } = {},
  db?: Database,
): Promise<CatalogListingRow[]> {
  return conn(db)
    .select({
      id: schema.listings.id,
      title: schema.listings.title,
      priceAmount: schema.listings.priceAmount,
      currency: schema.listings.currency,
      sizeValue: schema.listings.sizeValue,
      condition: schema.listings.condition,
      stock: schema.listings.stock,
      createdAt: schema.listings.createdAt,
      sellerDisplayName: schema.sellerProfiles.displayName,
    })
    .from(schema.listings)
    .innerJoin(schema.sellerProfiles, eq(schema.listings.sellerId, schema.sellerProfiles.id))
    .where(
      and(
        eq(schema.listings.status, 'active'),
        eq(schema.listings.moderationStatus, 'APPROVED'),
        gte(schema.listings.stock, 1),
      ),
    )
    .orderBy(desc(schema.listings.createdAt))
    .limit(opciones.limite ?? 60);
}

/** Una publicacion vista en su ficha, con los datos del vendedor que se exponen. */
export interface PublicListingDetailRow extends CatalogListingRow {
  description: string | null;
  kitType: ListingRow['kitType'];
  sleeve: ListingRow['sleeve'];
  authenticity: ListingRow['authenticity'];
  sellerId: string;
}

/**
 * Una publicacion del catalogo publico, por id.
 *
 * ⚠️ APLICA EL MISMO FILTRO QUE EL CATALOGO (ERD §9.1). Devolver una
 * publicacion pausada, agotada o sin aprobar solo porque alguien tiene su
 * enlace seria una via lateral para ver —y desde ahi intentar comprar— lo que
 * la vitrina esconde. Se devuelve `undefined` y la pagina responde 404.
 */
export async function findPublicById(
  id: string,
  db?: Database,
): Promise<PublicListingDetailRow | undefined> {
  const [row] = await conn(db)
    .select({
      id: schema.listings.id,
      title: schema.listings.title,
      description: schema.listings.description,
      priceAmount: schema.listings.priceAmount,
      currency: schema.listings.currency,
      sizeValue: schema.listings.sizeValue,
      condition: schema.listings.condition,
      kitType: schema.listings.kitType,
      sleeve: schema.listings.sleeve,
      authenticity: schema.listings.authenticity,
      stock: schema.listings.stock,
      createdAt: schema.listings.createdAt,
      sellerId: schema.listings.sellerId,
      sellerDisplayName: schema.sellerProfiles.displayName,
    })
    .from(schema.listings)
    .innerJoin(schema.sellerProfiles, eq(schema.listings.sellerId, schema.sellerProfiles.id))
    .where(
      and(
        eq(schema.listings.id, id),
        eq(schema.listings.status, 'active'),
        eq(schema.listings.moderationStatus, 'APPROVED'),
        gte(schema.listings.stock, 1),
      ),
    )
    .limit(1);

  return row;
}
