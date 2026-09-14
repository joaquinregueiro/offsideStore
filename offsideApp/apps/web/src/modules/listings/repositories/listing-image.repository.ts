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
  /**
   * URL absoluta. `null` es lo normal: la direccion publica depende de
   * configuracion y se compone al leer, asi que congelarla aca dejaria las
   * fotos apuntando al dominio viejo si algun dia cambia. La columna existe
   * porque el ERD §9.2 la define, y es anulable.
   */
  url: string | null;
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

/**
 * Posicion temporal para el intercambio. Ver `swapPositions`.
 *
 * ⚠️ ES NEGATIVA A PROPOSITO Y NO `max + 1`. `nextPosition` reparte desde 0
 * hacia arriba, asi que ningun valor negativo puede estar ocupado; `max + 1`,
 * en cambio, es exactamente la posicion que una subida concurrente esta por
 * tomar, y el intercambio chocaria contra esa foto recien subida.
 */
const POSICION_TEMPORAL = -1;

/**
 * Intercambia la posicion de dos imagenes de la misma publicacion.
 *
 * ⚠️ SON TRES UPDATES Y NO UNO, Y NO ES POR COMODIDAD. La tabla lleva
 * `UNIQUE(listing_id, position)` NO DIFERIBLE: PostgreSQL verifica el indice
 * fila por fila, asi que un unico `UPDATE ... SET position = CASE ...` que
 * intercambie dos valores FALLA a mitad de camino con violacion de unicidad.
 * El paso por una posicion temporal libera el valor antes de reclamarlo.
 *
 * ⚠️ VA EN UNA TRANSACCION Y ESO ES LO QUE LO HACE SEGURO. Sin ella, un corte
 * entre el primer y el tercer UPDATE dejaria una foto en la posicion temporal:
 * la galeria la mostraria PRIMERA —o sea, de portada— para siempre. Dos
 * reordenamientos simultaneos sobre la misma publicacion hacen fallar a uno por
 * unicidad, que es lo correcto: se pierde la operacion, nunca el orden.
 *
 * La transaccion la abre este repositorio porque la razon de existir de los
 * tres pasos es una restriccion de ESTA tabla: el Service no tiene por que
 * saber que el indice no es diferible.
 */
export async function swapPositions(
  aId: string,
  aPosition: number,
  bId: string,
  bPosition: number,
  db?: Database,
): Promise<void> {
  await conn(db).transaction(async (tx) => {
    await updatePosition(aId, POSICION_TEMPORAL, tx);
    await updatePosition(bId, aPosition, tx);
    await updatePosition(aId, bPosition, tx);
  });
}
