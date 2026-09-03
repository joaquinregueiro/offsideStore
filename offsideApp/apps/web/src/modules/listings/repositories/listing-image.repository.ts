import { getDatabase, schema, type Database } from '@offside/database';
import { and, asc, eq, inArray, max } from 'drizzle-orm';

/**
 * Acceso a `listing_images` (ERD §9.2). Sin reglas de negocio.
 *
 * La tabla ya existia en la migracion inicial y coincide con el ERD: no hizo
 * falta ningun cambio de esquema para las fotos.
 */

export type ListingImageRow = typeof schema.listingImages.$inferSelect;

const conn = (db?: Database): Database => db ?? getDatabase();

/** Imagenes de una publicacion, en el orden en que se muestran. */
export async function findByListingId(
  listingId: string,
  db?: Database,
): Promise<ListingImageRow[]> {
  return conn(db)
    .select()
    .from(schema.listingImages)
    .where(eq(schema.listingImages.listingId, listingId))
    .orderBy(asc(schema.listingImages.position));
}

/**
 * Imagenes de VARIAS publicaciones, para la vitrina.
 *
 * ⚠️ UNA SOLA CONSULTA para todas las publicaciones de la pagina. Pedir las
 * imagenes de cada una por separado seria el problema N+1: veinticuatro
 * consultas para pintar una grilla.
 *
 * Devuelve TODAS las imagenes ordenadas; quien llama se queda con la primera de
 * cada publicacion. Traer solo `position = 0` seria mas corto pero fallaria
 * cuando esa foto se borro: las posiciones son unicas, no consecutivas.
 */
export async function findByListingIds(
  listingIds: string[],
  db?: Database,
): Promise<ListingImageRow[]> {
  if (listingIds.length === 0) return [];

  return conn(db)
    .select()
    .from(schema.listingImages)
    .where(inArray(schema.listingImages.listingId, listingIds))
    .orderBy(asc(schema.listingImages.listingId), asc(schema.listingImages.position));
}

export async function countByListingId(listingId: string, db?: Database): Promise<number> {
  return (await findByListingId(listingId, db)).length;
}

/**
 * Proxima posicion libre de una publicacion.
 *
 * ⚠️ NO ES `count + 1`. Si se borro una imagen del medio, contar daria una
 * posicion ya ocupada y el UNIQUE(listing_id, position) rechazaria el insert.
 * Se toma el maximo y se suma uno.
 */
export async function nextPosition(listingId: string, db?: Database): Promise<number> {
  const [fila] = await conn(db)
    .select({ maxima: max(schema.listingImages.position) })
    .from(schema.listingImages)
    .where(eq(schema.listingImages.listingId, listingId));

  return (fila?.maxima ?? -1) + 1;
}

export interface InsertImageValues {
  listingId: string;
  storageKey: string;
  url: string;
  variants: unknown;
  position: number;
  alt: string | null;
  hash: string;
}

export async function insertImage(
  values: InsertImageValues,
  db?: Database,
): Promise<ListingImageRow> {
  const [row] = await conn(db).insert(schema.listingImages).values(values).returning();

  return row!;
}

/** Una imagen concreta de una publicacion. El `listingId` acota a proposito. */
export async function findByIdAndListing(
  id: string,
  listingId: string,
  db?: Database,
): Promise<ListingImageRow | undefined> {
  const [row] = await conn(db)
    .select()
    .from(schema.listingImages)
    .where(and(eq(schema.listingImages.id, id), eq(schema.listingImages.listingId, listingId)))
    .limit(1);

  return row;
}

export async function deleteImage(id: string, db?: Database): Promise<boolean> {
  const borradas = await conn(db)
    .delete(schema.listingImages)
    .where(eq(schema.listingImages.id, id))
    .returning({ id: schema.listingImages.id });

  return borradas.length === 1;
}

/**
 * Reasigna la posicion de una imagen. Para reordenar.
 *
 * ⚠️ `listing_images` NO tiene `updated_at`: el ERD §9.2 sólo define
 * `created_at`. No se agrega una columna para dejar rastro del reordenamiento
 * —eso seria un cambio de ERD (CLAUDE.md §5)—.
 */
export async function updatePosition(id: string, position: number, db?: Database): Promise<void> {
  await conn(db)
    .update(schema.listingImages)
    .set({ position })
    .where(eq(schema.listingImages.id, id));
}
