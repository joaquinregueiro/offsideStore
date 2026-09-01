import type { Database } from '@offside/database';

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

/**
 * Una publicacion es comprable (ERD §9.1).
 *
 * La regla del ERD es literal: `status='active'` **y**
 * `moderation_status='APPROVED'` **y** `stock >= 1`. Antes esta funcion solo
 * miraba `status`, y eso contradecia al ERD: una publicacion sin moderar
 * resultaba comprable.
 *
 * ⚠️ Se puede exigir `APPROVED` porque desde el 2026-09-01 las publicaciones
 * NACEN aprobadas (ver `publishListing`). Con moderacion previa real, esta
 * misma funcion sigue sirviendo sin cambios.
 */
export function isPurchasable(listing: listingRepo.ListingRow): boolean {
  return (
    listing.status === 'active' && listing.moderationStatus === 'APPROVED' && listing.stock >= 1
  );
}

/**
 * Descuenta stock atomicamente. Ver `listingRepo.decrementStock`.
 *
 * Existe en el Service —y no se llama al repositorio desde `orders`— para no
 * saltear el layering: cada modulo entra al de al lado por su Service.
 */
export async function decrementStock(
  listingId: string,
  quantity: number,
  db?: Database,
): Promise<number | undefined> {
  return listingRepo.decrementStock(listingId, quantity, db);
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
    /**
     * ⚠️ APROBACION AUTOMATICA — DECISION TRANSITORIA del owner (2026-09-01).
     *
     * `configuration-registry.md` §8 lista las "reglas de moderacion
     * (pre/post publicacion)" como configuracion administrativa SIN valor
     * definido. Mientras eso siga abierto, las publicaciones nacen
     * `APPROVED`.
     *
     * POR QUE, y no es comodidad: el ERD §9.1 exige `APPROVED` para que algo
     * sea comprable, y nada asignaba ese estado. Nacer `PENDING` volvia la
     * regla del ERD imposible de cumplir, y el codigo la ignoraba para
     * compensar. Naciendo `APPROVED`, el codigo hace lo que el ERD dice.
     *
     * ⚠️ ESTO NO ESCALA. Es viable mientras el volumen sea bajo y el owner
     * conozca a los vendedores. RISK-FR1 (falsificaciones) es Critico/Alta:
     * cuando haya vendedores desconocidos hay que decidir la politica de
     * moderacion de verdad y cambiar esta linea.
     */
    moderationStatus: 'APPROVED',
  });

  return toPublicListing(creada);
}

/** Publicaciones propias del vendedor autenticado. */
export async function listMyListings(user: PublicUser): Promise<PublicListing[]> {
  const seller = await requireOwnSellerProfile(user);
  const rows = await listingRepo.findBySellerId(seller.id);

  return rows.map(toPublicListing);
}

/** Publicacion tal como la ve cualquiera en la vitrina. NUNCA datos del vendedor. */
export interface CatalogListing {
  id: string;
  title: string;
  /** Centavos como string: el dinero es `bigint` y un `number` no lo representa. */
  priceAmount: string;
  currency: string;
  sizeValue: string;
  condition: listingRepo.ListingRow['condition'];
  sellerDisplayName: string;
}

/**
 * Catalogo publico. No exige sesion: es la vitrina.
 *
 * El filtro lo aplica el repositorio con la regla del ERD §9.1, la misma que
 * `isPurchasable`. Lo que se ve es lo que se puede comprar; mostrar algo no
 * comprable seria prometer lo que no se puede cumplir.
 */
export async function listPublicCatalog(limite?: number): Promise<CatalogListing[]> {
  const filas = await listingRepo.findPublicCatalog(limite === undefined ? {} : { limite });

  return filas.map((row) => ({
    id: row.id,
    title: row.title,
    priceAmount: row.priceAmount.toString(),
    currency: row.currency,
    sizeValue: row.sizeValue,
    condition: row.condition,
    sellerDisplayName: row.sellerDisplayName,
  }));
}

/** Ficha publica de una publicacion. */
export interface PublicListingDetail extends CatalogListing {
  description: string | null;
  kitType: listingRepo.ListingRow['kitType'];
  sleeve: listingRepo.ListingRow['sleeve'];
  authenticity: listingRepo.ListingRow['authenticity'];
  /** Cuantas unidades quedan. La ficha lo usa para avisar si queda poco. */
  stock: number;
}

/**
 * Ficha publica por id. No exige sesion: es parte de la vitrina.
 *
 * Devuelve `null` si la publicacion no existe **o no es comprable**: quien
 * tenga un enlace viejo no deberia poder ver lo que la vitrina esconde.
 */
export async function findPublicListing(id: string): Promise<PublicListingDetail | null> {
  const row = await listingRepo.findPublicById(id);
  if (row === undefined) return null;

  return {
    id: row.id,
    title: row.title,
    description: row.description,
    priceAmount: row.priceAmount.toString(),
    currency: row.currency,
    sizeValue: row.sizeValue,
    condition: row.condition,
    kitType: row.kitType,
    sleeve: row.sleeve,
    authenticity: row.authenticity,
    stock: row.stock,
    sellerDisplayName: row.sellerDisplayName,
  };
}
