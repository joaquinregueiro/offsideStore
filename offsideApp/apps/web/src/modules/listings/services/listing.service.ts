import type { Database } from '@offside/database';

import type { PublicUser } from '../../auth/services/auth.service';
import { canSellerOperate } from '../../sellers/services/mercadopago-connection.service';
import { requireOwnSellerProfile } from '../../sellers/services/seller.service';
import * as errors from '../listings.errors';
import { createStorage } from '../infrastructure/storage/index';
import * as catalogRepo from '../repositories/catalog.repository';
import * as imageRepo from '../repositories/listing-image.repository';
import * as listingRepo from '../repositories/listing.repository';
import { reindex } from './search.service';

/**
 * Publicaciones — alta, vitrina publica y ficha.
 *
 * ⚠️ ESTE COMENTARIO DECIA QUE FALTABAN EDITAR, PAUSAR, ELIMINAR, IMAGENES,
 * BUSQUEDA E INDEXADO. Las seis estan en produccion desde el 2026-09-08 —viven
 * en `listing-editing.service.ts`, `listing-image.service.ts` y
 * `search.service.ts`—, asi que el comentario mandaba a buscar en el lugar
 * equivocado a quien llegara nuevo. Lo que de verdad falta hoy es la
 * MODERACION: `moderation_status` se lee en el filtro del ERD §9.1 y no hay
 * ningun flujo que lo cambie.
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
  /**
   * Referencias de catalogo. Todas OPCIONALES: son las que alimentan las
   * facetas, pero exigirlas dejaria afuera cualquier camiseta cuyo club o marca
   * no este sembrado, y el flujo de propuestas (DEC-041) todavia no existe.
   */
  clubId?: string | null;
  nationalTeamId?: string | null;
  brandId?: string | null;
  competitionId?: string | null;
  seasonId?: string | null;
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
  /** Obligatorios para camiseta (ERD §9.1). El formulario de edicion los necesita. */
  kitType: listingRepo.ListingRow['kitType'];
  sleeve: listingRepo.ListingRow['sleeve'];
  categoryId: string;
  /**
   * Referencias de catalogo (ERD §8).
   *
   * ⚠️ SE EXPONEN PARA QUE EL FORMULARIO DE EDICION PUEDA MOSTRARLAS. Sin
   * esto, el formulario no tenia los cinco selectores, la accion los leia como
   * ausentes y el repositorio escribia `null`: **corregir un typo en el titulo
   * borraba el club, la marca y la temporada**. El parche defensivo en la
   * accion evita la perdida; estos campos son lo que permite EDITARLAS.
   */
  clubId: string | null;
  nationalTeamId: string | null;
  brandId: string | null;
  competitionId: string | null;
  seasonId: string | null;
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
    clubId: row.clubId,
    nationalTeamId: row.nationalTeamId,
    brandId: row.brandId,
    competitionId: row.competitionId,
    seasonId: row.seasonId,
    stock: row.stock,
    sizeValue: row.sizeValue,
    condition: row.condition,
    kitType: row.kitType,
    sleeve: row.sleeve,
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
    clubId: input.clubId ?? null,
    nationalTeamId: input.nationalTeamId ?? null,
    brandId: input.brandId ?? null,
    competitionId: input.competitionId ?? null,
    seasonId: input.seasonId ?? null,
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

  // El indice de busqueda lo mantiene el Service, no un trigger (DEC-042).
  await reindex(creada.id);

  return toPublicListing(creada);
}

/** Categoria tal como la elige el vendedor al publicar. */
export interface PublicCategory {
  id: string;
  name: string;
  /** `camiseta` obliga a declarar `kitType` y `sleeve` (ERD §9.1). */
  code: string;
}

/**
 * Categorias disponibles para publicar.
 *
 * No exige sesion: es catalogo publico, y el mismo listado sirve para filtrar
 * la vitrina el dia que exista la busqueda.
 */
export async function listActiveCategories(): Promise<PublicCategory[]> {
  const rows = await listingRepo.findActiveCategories();

  return rows.map((row) => ({ id: row.id, name: row.name, code: row.code }));
}

/**
 * Marca una publicacion como AGOTADA (SS-051).
 *
 * ⚠️ SOLO DESDE `active`. Una pausada o eliminada no pasa a agotada: su
 * estado lo decidio una persona y no lo pisa un efecto secundario del stock.
 * La condicion de origen va en el WHERE, asi que es atomica.
 */
export async function markSoldOut(listingId: string, db?: Database): Promise<void> {
  await listingRepo.transitionStatus(listingId, 'active', 'sold_out', db);
}

/** Catalogos que el formulario de publicar ofrece (ERD §8). */
export interface CatalogosDePublicacion {
  clubes: catalogRepo.CatalogRow[];
  selecciones: catalogRepo.CatalogRow[];
  marcas: catalogRepo.CatalogRow[];
  competiciones: catalogRepo.CatalogRow[];
  temporadas: catalogRepo.CatalogRow[];
}

/**
 * Los cinco catalogos elegibles, para armar el formulario.
 *
 * No exige sesion: son datos publicos, los mismos que se usan para filtrar.
 */
export async function listCatalogs(): Promise<CatalogosDePublicacion> {
  const [clubes, selecciones, marcas, competiciones, temporadas] = await Promise.all([
    catalogRepo.findActive('club'),
    catalogRepo.findActive('nationalTeam'),
    catalogRepo.findActive('brand'),
    catalogRepo.findActive('competition'),
    catalogRepo.findActive('season'),
  ]);

  return { clubes, selecciones, marcas, competiciones, temporadas };
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
  /**
   * Cuantas unidades quedan.
   *
   * ⚠️ SE CONSULTABA Y SE DESCARTABA EN EL MAPPER. `findPublicCatalog` ya
   * selecciona `stock`, y la ficha del catalogo lo tiraba: la grilla no podia
   * distinguir la camiseta de la que queda una de la que tiene diez. "Ultima
   * unidad" es la señal que mas mueve una compra en un marketplace de piezas
   * unicas, y estaba a un campo de distancia.
   */
  stock: number;
  sellerDisplayName: string;
  /**
   * Foto de portada, o `null` si la publicacion no tiene ninguna.
   *
   * ⚠️ PUEDE SER `null` MIENTRAS PS-010 NO SE EXIJA. La regla dice que hace
   * falta al menos una foto para publicar, pero todavia no se aplica —eso es la
   * fase 4— y hay publicaciones creadas antes de que existieran las fotos.
   * La vitrina tiene que saber pintar esa fila igual.
   */
  coverUrl: string | null;
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

  // Las portadas salen en UNA consulta para toda la pagina, no una por fila:
  // pedirlas de a una seria el problema N+1.
  const portadas = await coverUrls(filas.map((row) => row.id));

  return filas.map((row) => ({
    id: row.id,
    title: row.title,
    priceAmount: row.priceAmount.toString(),
    currency: row.currency,
    sizeValue: row.sizeValue,
    condition: row.condition,
    stock: row.stock,
    sellerDisplayName: row.sellerDisplayName,
    coverUrl: portadas.get(row.id) ?? null,
  }));
}

/**
 * Portada de cada publicacion: la imagen de menor `position`.
 *
 * Se usa la variante `medium`, no la `thumb`: en una grilla las tarjetas se
 * ven a ~400px de ancho pero en pantallas de alta densidad eso son 800 fisicos,
 * y la miniatura se veria borrosa.
 */
/**
 * Portadas de varias publicaciones, en una sola consulta.
 *
 * ⚠️ SE EXPORTA PARA QUE LAS PANTALLAS DE COMPRA PUEDAN MOSTRAR LA FOTO. "Mis
 * compras" y el resumen de una orden viven en el modulo `orders`, que no puede
 * —ni debe— importar el repositorio de `listings`. La composicion la hace la
 * PANTALLA: pide la orden a un modulo y las portadas al otro. Es la misma
 * costura que ya usa la vitrina.
 *
 * ⚠️ DEVUELVE UN MAPA, NO UNA LISTA. Quien llama tiene los ids y necesita
 * buscar por id; devolver una lista lo obligaria a recorrerla por cada fila.
 */
export async function coverUrls(listingIds: string[]): Promise<Map<string, string>> {
  const imagenes = await imageRepo.findByListingIds(listingIds);
  const portadas = new Map<string, string>();

  for (const imagen of imagenes) {
    // Vienen ordenadas por posicion: la primera de cada listing es la portada.
    if (portadas.has(imagen.listingId)) continue;

    const url = urlDeVariante(imagen, 'medium');
    if (url !== null) portadas.set(imagen.listingId, url);
  }

  return portadas;
}

/**
 * URL de una variante.
 *
 * ⚠️ `variants` guarda CLAVES, no URLs: el dominio publico es configuracion y
 * puede cambiar, asi que la direccion se compone al leer. Un valor que ya sea
 * absoluto se devuelve tal cual —las primeras filas guardaron URLs completas—.
 */
function urlDeVariante(imagen: imageRepo.ListingImageRow, variante: string): string | null {
  const variants =
    imagen.variants !== null && typeof imagen.variants === 'object'
      ? (imagen.variants as Record<string, string>)
      : {};

  const guardado = variants[variante] ?? imagen.storageKey;
  if (guardado === undefined || guardado === '') return imagen.url ?? null;

  return /^https?:\/\//.test(guardado) ? guardado : createStorage().publicUrl(guardado);
}

/** Ficha publica de una publicacion. */
export interface PublicListingDetail extends CatalogListing {
  description: string | null;
  kitType: listingRepo.ListingRow['kitType'];
  sleeve: listingRepo.ListingRow['sleeve'];
  authenticity: listingRepo.ListingRow['authenticity'];
  /** Cuantas unidades quedan. La ficha lo usa para avisar si queda poco. */
  stock: number;
  /** Galeria completa, en orden. Vacia si la publicacion no tiene fotos. */
  images: { url: string; alt: string | null }[];
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

  const imagenes = await imageRepo.findByListingId(row.id);

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
    // La ficha usa la variante grande; la portada del detalle es la primera.
    coverUrl: imagenes[0] === undefined ? null : urlDeVariante(imagenes[0], 'medium'),
    images: imagenes.flatMap((imagen) => {
      const url = urlDeVariante(imagen, 'large');

      return url === null ? [] : [{ url, alt: imagen.alt }];
    }),
  };
}

/** Cuantas publicaciones tiene el vendedor autenticado, por estado. */
export interface ResumenDePublicaciones {
  activas: number;
  pausadas: number;
  borradores: number;
  agotadas: number;
  total: number;
}

/**
 * Resumen del inventario para el panel del vendedor (SS-060).
 *
 * ⚠️ NO REUSA `listMyListings`. Esa funcion trae las filas para pintarlas;
 * esto necesita cuatro numeros. Contar en memoria lo que la base puede contar
 * con un `GROUP BY` obliga a traer el catalogo entero en cada visita al panel.
 */
export async function countMyListings(user: PublicUser): Promise<ResumenDePublicaciones> {
  const seller = await requireOwnSellerProfile(user);
  const filas = await listingRepo.countBySellerId(seller.id);

  const por = (estado: string): number =>
    filas.find((fila) => fila.status === estado)?.cantidad ?? 0;

  return {
    activas: por('active'),
    pausadas: por('paused'),
    borradores: por('draft'),
    agotadas: por('sold_out'),
    total: filas.reduce((suma, fila) => suma + fila.cantidad, 0),
  };
}
