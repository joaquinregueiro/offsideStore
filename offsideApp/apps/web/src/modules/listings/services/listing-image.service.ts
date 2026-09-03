import type { PublicUser } from '../../auth/services/auth.service';
import { getImageSettings } from '../../config/services/image-settings.service';
import { requireOwnSellerProfile } from '../../sellers/services/seller.service';
import * as errors from '../listings.errors';
import * as imageRepo from '../repositories/listing-image.repository';
import * as listingRepo from '../repositories/listing.repository';
import {
  FORMATO_DE_SALIDA,
  ImagenInvalidaError,
  procesarImagen,
  type NombreDeVariante,
} from '../infrastructure/storage/image-processor';
import { createStorage } from '../infrastructure/storage/index';

/**
 * Fotos de una publicacion (PS-010 / PS-012, ERD §9.2).
 *
 * ⚠️ AUTORIZACION: la publicacion tiene que ser del vendedor autenticado. El
 * perfil se resuelve POR `user.id` con el mismo helper que usa el resto del
 * modulo, y despues se compara contra `listings.seller_id`. No hay parametro
 * que manipular para tocar la publicacion de otro.
 *
 * ⚠️ EL PROCESAMIENTO ES SINCRONO, dentro del request. Tres variantes de una
 * foto de 5 MB tardan cientos de milisegundos, y a cambio el vendedor ve el
 * resultado en el acto. Si algun dia pesa, se mueve a BullMQ —la cola ya
 * existe— y la subida pasa a devolver "procesando". No se hace ahora porque
 * agregaria un estado intermedio que la interfaz tendria que explicar.
 */

/** Una imagen tal como la ve quien consulta. */
export interface PublicListingImage {
  id: string;
  url: string;
  /** URLs por variante: `thumb`, `medium`, `large`. */
  variants: Record<string, string>;
  position: number;
  alt: string | null;
}

function toPublicImage(row: imageRepo.ListingImageRow): PublicListingImage {
  const variants =
    row.variants !== null && typeof row.variants === 'object'
      ? (row.variants as Record<string, string>)
      : {};

  return {
    id: row.id,
    // `url` es la de la variante grande; se guarda desnormalizada para no tener
    // que leer el jsonb cuando sólo hace falta una.
    url: row.url ?? variants.large ?? '',
    variants,
    position: row.position,
    alt: row.alt,
  };
}

/** Imagenes de una publicacion. Publico: no revela nada del vendedor. */
export async function listImages(listingId: string): Promise<PublicListingImage[]> {
  const rows = await imageRepo.findByListingId(listingId);

  return rows.map(toPublicImage);
}

/**
 * Resuelve la publicacion comprobando que sea del vendedor autenticado.
 *
 * Devuelve el mismo error para "no existe" y "no es tuya": distinguirlos
 * permitiria averiguar que publicaciones existen.
 */
async function requireOwnListing(user: PublicUser, listingId: string) {
  const seller = await requireOwnSellerProfile(user);
  const listing = await listingRepo.findById(listingId);

  if (listing?.sellerId !== seller.id) throw errors.listingNotFound();

  return listing;
}

export interface UploadImageInput {
  listingId: string;
  bytes: Buffer;
  /** Texto alternativo. Accesibilidad; opcional. */
  alt?: string | null;
}

/**
 * Sube una foto a una publicacion.
 *
 * Orden de las comprobaciones: lo mas barato y lo mas restrictivo primero.
 * Autorizacion → cupo → tamaño → contenido. Decodificar una imagen es lo mas
 * caro de todo, asi que va ultimo.
 */
export async function uploadImage(
  user: PublicUser,
  input: UploadImageInput,
): Promise<PublicListingImage> {
  const listing = await requireOwnListing(user, input.listingId);

  const settings = await getImageSettings();

  const yaTiene = await imageRepo.countByListingId(listing.id);
  if (yaTiene >= settings.maxImages) {
    throw errors.tooManyImages(settings.maxImages);
  }

  // ⚠️ El tamaño se comprueba ANTES de decodificar. Al reves, una bomba de
  // descompresion se expandiria en memoria antes de que el limite la frene.
  if (input.bytes.byteLength === 0) throw errors.invalidImage('El archivo está vacío');
  if (input.bytes.byteLength > settings.maxBytes) {
    throw errors.imageTooLarge(settings.maxBytes);
  }

  let procesada;
  try {
    procesada = await procesarImagen(input.bytes, settings.allowedTypes);
  } catch (error) {
    if (error instanceof ImagenInvalidaError) throw errors.invalidImage(error.message);
    throw error;
  }

  const storage = createStorage();
  const position = await imageRepo.nextPosition(listing.id);

  /**
   * ⚠️ LA CLAVE LLEVA EL HASH, y eso tiene dos consecuencias buenas: subir dos
   * veces la misma foto escribe el mismo objeto en vez de duplicarlo, y la URL
   * puede cachearse para siempre porque su contenido nunca cambia.
   *
   * No lleva nada que venga del cliente: se arma con el id de la publicacion,
   * el hash y el nombre de la variante.
   */
  const claveDe = (variante: NombreDeVariante): string =>
    `listings/${listing.id}/${procesada.hash}-${variante}.webp`;

  const subidas = await Promise.all(
    procesada.variantes.map(async (variante) => {
      const objeto = await storage.put({
        key: claveDe(variante.nombre),
        body: variante.buffer,
        contentType: FORMATO_DE_SALIDA,
      });

      return [variante.nombre, objeto.url] as const;
    }),
  );

  const variants = Object.fromEntries(subidas);

  /**
   * ⚠️ SE ESCRIBE EN LA BASE DESPUES DE SUBIR. Si el insert falla, quedan
   * objetos en el bucket que nadie referencia: basura que cuesta plata, no un
   * problema de correctitud. Al reves seria peor —una fila apuntando a una
   * imagen que no existe rompe la vitrina—.
   */
  const fila = await imageRepo.insertImage({
    listingId: listing.id,
    storageKey: claveDe('large'),
    url: variants.large ?? '',
    variants,
    position,
    alt: input.alt?.trim() === '' ? null : (input.alt ?? null),
    hash: procesada.hash,
  });

  return toPublicImage(fila);
}

/**
 * Borra una foto.
 *
 * ⚠️ NO REACOMODA LAS POSICIONES de las que quedan. El ERD sólo exige que sean
 * UNICAS por publicacion, no consecutivas, y `nextPosition` toma el maximo — no
 * la cantidad—, asi que un hueco no rompe nada. Renumerar seria escribir N
 * filas para un efecto que nadie ve.
 *
 * ⚠️ EL OBJETO DEL BUCKET SE BORRA DESPUES, y si falla NO se revierte la fila.
 * La foto ya no se muestra, que es lo que la persona pidio; el objeto huerfano
 * es basura, no un error visible.
 */
export async function deleteImage(user: PublicUser, listingId: string, imageId: string) {
  const listing = await requireOwnListing(user, listingId);

  const imagen = await imageRepo.findByIdAndListing(imageId, listing.id);
  if (imagen === undefined) throw errors.imageNotFound();

  await imageRepo.deleteImage(imagen.id);

  const storage = createStorage();
  const variants =
    imagen.variants !== null && typeof imagen.variants === 'object'
      ? (imagen.variants as Record<string, string>)
      : {};

  // Se borran las tres variantes. `delete` es idempotente en el puerto.
  await Promise.all(
    Object.keys(variants).map(async (variante) => {
      try {
        await storage.delete(`listings/${listing.id}/${imagen.hash}-${variante}.webp`);
      } catch (error) {
        // Que no se pueda borrar del bucket NO puede fallar la operacion: la
        // fila ya no existe y la foto ya no se ve. Se registra para poder
        // limpiarlo despues.
        console.error(
          `[listings] no se pudo borrar del storage la imagen ${imagen.id}:`,
          error instanceof Error ? error.message : String(error),
        );
      }
    }),
  );
}
