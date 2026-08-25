import type { PublicUser } from '../../auth/services/auth.service';
import { canSellerOperate } from '../../sellers/services/mercadopago-connection.service';
import { requireOwnSellerProfile } from '../../sellers/services/seller.service';
import * as errors from '../listings.errors';
import * as listingRepo from '../repositories/listing.repository';

/**
 * Publicaciones — **alcance minimo**: publicar y listar las propias.
 *
 * ⚠️ TODAVIA NO ES EL MODULO COMPLETO. Faltan: editar, pausar, eliminar,
 * imagenes, moderacion, busqueda e indexado (`search_vector`). Lo que hay
 * alcanza para que un vendedor ponga algo a la venta y un comprador lo compre.
 */

export type { ListingRow } from '../repositories/listing.repository';

/** Estados en los que una publicacion admite compra. */
export function isPurchasable(listing: listingRepo.ListingRow): boolean {
  return listing.status === 'active';
}

export async function findById(listingId: string): Promise<listingRepo.ListingRow | undefined> {
  return listingRepo.findById(listingId);
}

/* -------------------------------------------------------------------------- */
/* Publicacion                                                                 */
/* -------------------------------------------------------------------------- */

/** Categoria que exige atributos especificos de camiseta (ERD §9.1). */
const CATEGORIA_CAMISETA = 'camiseta';

export interface PublishListingInput {
  categoryId: string;
  title: string;
  description: string | null;
  /** Centavos, como todo el dinero del ERD (§1). */
  priceAmount: bigint;
  stock: number;
  sizeValue: string;
  condition: listingRepo.ListingRow['condition'];
  kitType: listingRepo.ListingRow['kitType'];
  sleeve: listingRepo.ListingRow['sleeve'];
}

export interface PublicListing {
  id: string;
  title: string;
  description: string | null;
  status: listingRepo.ListingRow['status'];
  moderationStatus: listingRepo.ListingRow['moderationStatus'];
  priceAmount: string;
  currency: string;
  stock: number;
  sizeValue: string;
  condition: listingRepo.ListingRow['condition'];
  categoryId: string;
  createdAt: string;
}

export function toPublicListing(row: listingRepo.ListingRow): PublicListing {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    moderationStatus: row.moderationStatus,
    priceAmount: row.priceAmount.toString(),
    currency: row.currency,
    stock: row.stock,
    sizeValue: row.sizeValue,
    condition: row.condition,
    categoryId: row.categoryId,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Publica una camiseta (o cualquier prenda) a la venta.
 *
 * AUTORIZACION: se resuelve el perfil del vendedor POR `user.id` y se exige que
 * pueda operar —aprobado + Mercado Pago conectado—, con los MISMOS predicados
 * que usa el resto del sistema. Publicar algo que despues no se va a poder
 * cobrar no le sirve a nadie.
 *
 * ⚠️ ALCANCE MINIMO, deliberado. Lo que **no** hace:
 *
 *  - **No sube imagenes.** El almacenamiento S3 no esta implementado.
 *  - **No modera.** `moderation_status` nace `PENDING` y es independiente de
 *    `status` (ERD §9.1). Quien aprueba y si un `PENDING` frena la venta siguen
 *    🟡 sin decidir; no se inventa ninguna de las dos cosas.
 *  - **No indexa para busqueda.** `search_vector` lo puebla el Service de
 *    busqueda (DEC-042), que no existe.
 *  - **No valida limites de publicacion.** Los cupos son ⚙️ del Config Store y
 *    sus valores siguen 🟡.
 */
export async function publishListing(
  user: PublicUser,
  input: PublishListingInput,
): Promise<PublicListing> {
  const seller = await requireOwnSellerProfile(user);

  if (!(await canSellerOperate(seller.id))) throw errors.sellerNotOperational();

  const categoria = await listingRepo.findCategoryById(input.categoryId);
  if (categoria?.isActive !== true) throw errors.invalidCategory();

  // ERD §9.1: obligatorio para camiseta, validado en la app y no por un CHECK.
  if (categoria.code === CATEGORIA_CAMISETA && (input.kitType === null || input.sleeve === null)) {
    throw errors.missingShirtAttributes();
  }

  const creada = await listingRepo.insertListing({
    sellerId: seller.id,
    categoryId: input.categoryId,
    title: input.title,
    description: input.description,
    priceAmount: input.priceAmount,
    // Una sola moneda en el MVP; el ERD ya exige `currency` en toda tabla con
    // importes y la orden copia la del listing.
    currency: 'ARS',
    stock: input.stock,
    sizeValue: input.sizeValue,
    condition: input.condition,
    kitType: input.kitType,
    sleeve: input.sleeve,
  });

  return toPublicListing(creada);
}

/** Publicaciones propias del vendedor autenticado. */
export async function listMyListings(user: PublicUser): Promise<PublicListing[]> {
  const seller = await requireOwnSellerProfile(user);
  const rows = await listingRepo.findBySellerId(seller.id);

  return rows.map(toPublicListing);
}
