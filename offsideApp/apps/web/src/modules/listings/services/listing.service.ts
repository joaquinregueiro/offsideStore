import type { Database } from '@offside/database';
import { esUuid } from '@offside/utils';

import type { PublicUser } from '../../auth/services/auth.service';
import { canSellerOperate } from '../../sellers/services/mercadopago-connection.service';
import { requireOwnSellerProfile } from '../../sellers/services/seller.service';
import * as errors from '../listings.errors';
import { coverImages, srcSetDe, urlDeVariante, type Portada } from './listing-cover.service';
import * as catalogRepo from '../repositories/catalog.repository';
import * as imageRepo from '../repositories/listing-image.repository';
import * as listingRepo from '../repositories/listing.repository';
import { getShippingSettings } from './listing-settings.service';
import { reindex } from './search.service';
import {
  shippingSummaryFor,
  validateShippingDeclaration,
  type ShippingSummary,
} from './shipping-declaration';

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

/**
 * Tope del nombre del jugador. `player_name` es `text` sin limite en el ERD,
 * asi que el techo lo pone la app: es el mismo criterio que `size_value` (20) y
 * el titulo (140). Un nombre de jugador no llega a 60 caracteres ni con el
 * apellido completo, y sin tope el campo es un lugar comodo para meter un
 * parrafo que despues pesa `B` en el indice de busqueda.
 */
export const TOPE_NOMBRE_JUGADOR = 60;

/**
 * Rango del numero estampado. `player_number` es `integer` en el ERD y no
 * tiene CHECK, asi que el rango lo valida la app —igual que `kit_type` y
 * `sleeve` para camiseta—.
 *
 * ⚠️ EMPIEZA EN 0 Y NO EN 1: el 0 se usa de verdad (lo llevaron Ronaldo en el
 * Corinthians y varios arqueros), y llega hasta 99 porque es el maximo que
 * admiten los reglamentos que numeran de dos digitos. Un 0 valido obliga a que
 * el resto del codigo compare contra `null`, NUNCA por falsedad.
 */
export const NUMERO_JUGADOR_MIN = 0;
export const NUMERO_JUGADOR_MAX = 99;

/**
 * Normaliza el nombre del jugador tal como llega de un formulario.
 *
 * Vacio —o solo espacios— es `null`, no `''`: el ERD deja la columna anulable
 * para decir "no tiene", y una cadena vacia seria un tercer valor que significa
 * lo mismo. Ademas entra al `search_vector` con peso `B`, donde `coalesce` ya
 * trata el null; una cadena vacia con espacios no aporta nada y ensucia.
 */
export function normalizarJugador(valor: string | null | undefined): string | null {
  if (valor === null || valor === undefined) return null;

  const limpio = valor.trim().replace(/\s+/g, ' ');

  return limpio === '' ? null : limpio.slice(0, TOPE_NOMBRE_JUGADOR);
}

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
   * Jugador y numero estampados (ERD §9.1).
   *
   * ⚠️ NO SON UN CAMPO NUEVO: `player_name` y `player_number` estaban en el
   * ERD desde la migracion inicial, tienen su indice trigram
   * (`listings_player_name_trgm_idx`) y `player_name` YA PESA `B` EN EL
   * `search_vector` (ver `search.repository.ts`). Es decir: toda la busqueda
   * por jugador estaba construida y no habia forma de cargar el dato. Esto no
   * agrega una funcion, la conecta.
   *
   * Opcionales de verdad: la mayoria de las camisetas que se venden son lisas,
   * y exigir el jugador convertiria "no tiene" en "mentir algo".
   */
  playerName?: string | null;
  playerNumber?: number | null;
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
  /**
   * Envio DECLARADO por el vendedor (delta §11). Opcional: sin Correo
   * Argentino no hay cotizacion, asi que quien no elige cae en
   * `shipping_default_mode` del Config Store. `buyer_pays` exige costo.
   */
  shippingMode?: string | null;
  shippingCostAmount?: bigint | null;
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
  /** Jugador y numero. El formulario de edicion los necesita para mostrarlos. */
  playerName: string | null;
  playerNumber: number | null;
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
  /**
   * Envio DECLARADO por el vendedor (delta §11).
   *
   * ⚠️ SE EXPONE POR EL MISMO MOTIVO QUE LOS CATALOGOS: sin esto, el
   * formulario de edicion no puede mostrar el modo actual, y el inventario no
   * puede decir como se envia cada publicacion. `shippingCostAmount` viaja
   * como string de centavos, igual que el precio.
   */
  shippingMode: string;
  shippingCostAmount: string | null;
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
    playerName: row.playerName,
    playerNumber: row.playerNumber,
    categoryId: row.categoryId,
    shippingMode: row.shippingMode,
    shippingCostAmount: row.shippingCostAmount?.toString() ?? null,
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

  /*
   * ⚠️ EL ENVIO SE VALIDA CONTRA EL CONFIG STORE, NO CONTRA UNA CONSTANTE. Que
   * modos se pueden elegir (`pickup`, `to_agree`) son perillas ⚙️, y el modo
   * por defecto tambien: exigir uno en el formulario dejaria afuera a quien
   * publica sin pensar en el envio, que es la mayoria la primera vez.
   */
  const envio = validateShippingDeclaration(
    {
      ...(input.shippingMode === undefined ? {} : { shippingMode: input.shippingMode }),
      ...(input.shippingCostAmount === undefined
        ? {}
        : { shippingCostAmount: input.shippingCostAmount }),
    },
    await getShippingSettings(),
  );

  const creada = await listingRepo.insertListing({
    sellerId: seller.id,
    shippingMode: envio.shippingMode,
    shippingCostAmount: envio.shippingCostAmount,
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
    playerName: normalizarJugador(input.playerName),
    playerNumber: input.playerNumber ?? null,
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
  /**
   * Las tres variantes de la portada como `srcset`, o `null` si no hay foto.
   *
   * ⚠️ EXISTE PORQUE `coverUrl` SOLA DESPERDICIA ANCHO DE BANDA. Se generan
   * `thumb` (400), `medium` (800) y `large` (1600) y la grilla servia SIEMPRE
   * la de 800, para fichas que en un telefono se ven a 150px. El navegador
   * elige con esto; `coverUrl` se queda como respaldo para quien no entienda
   * `srcset`.
   */
  coverSrcSet: string | null;
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
  const portadas = await coverImages(filas.map((row) => row.id));

  return filas.map((row) => toCatalogListing(row, portadas.get(row.id) ?? null));
}

/**
 * Fila de catalogo → ficha publica. Una sola definicion para la vitrina, la
 * seccion de promocionadas y la tienda de un vendedor: si difirieran, la misma
 * camiseta se veria distinta segun por donde se llegue.
 */
function toCatalogListing(
  row: listingRepo.CatalogListingRow,
  portada: Portada | null,
): CatalogListing {
  return {
    id: row.id,
    title: row.title,
    priceAmount: row.priceAmount.toString(),
    currency: row.currency,
    sizeValue: row.sizeValue,
    condition: row.condition,
    stock: row.stock,
    sellerDisplayName: row.sellerDisplayName,
    coverUrl: portada?.url ?? null,
    coverSrcSet: portada?.srcSet ?? null,
  };
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
  const portadas = await coverImages(listingIds);

  return new Map([...portadas].map(([id, portada]) => [id, portada.url]));
}

/**
 * ⚠️ SE RE-EXPORTAN PARA NO MOVERLE EL API A NADIE. `coverImages` y `Portada`
 * viven en `listing-cover.service` por un ciclo de imports (ver ese archivo),
 * pero las pantallas y los otros modulos vienen pidiendole las portadas a
 * `listing.service` desde siempre.
 */
export { coverImages, type Portada };

/** Ficha publica de una publicacion. */
export interface PublicListingDetail extends CatalogListing {
  description: string | null;
  kitType: listingRepo.ListingRow['kitType'];
  sleeve: listingRepo.ListingRow['sleeve'];
  /** Jugador y numero estampados. La ficha los muestra; casi siempre son null. */
  playerName: string | null;
  playerNumber: number | null;
  authenticity: listingRepo.ListingRow['authenticity'];
  /** Cuantas unidades quedan. La ficha lo usa para avisar si queda poco. */
  stock: number;
  /** Galeria completa, en orden. Vacia si la publicacion no tiene fotos. */
  images: { url: string; srcSet: string | null; alt: string | null }[];
  /**
   * Quien vende.
   *
   * ⚠️ EL REPOSITORIO YA LOS TRAIA Y EL MAPPER LOS TIRABA. Sin `sellerId`, la
   * ficha no puede mostrar la reputacion ni el nivel del vendedor, no puede
   * decir en cuanto responde las preguntas, no puede esconderle el formulario
   * de preguntas al propio dueño y —lo peor— nada enlaza a `/tienda/[sellerId]`:
   * la tienda publica existia y era inalcanzable navegando.
   */
  sellerId: string;
  /** `users.username`, si lo eligio. Hoy nadie lo tiene: no hay flujo que lo asigne. */
  sellerUsername: string | null;
  /**
   * Como se resuelve el envio, YA RESUMIDO (modo + costo + etiqueta legible).
   *
   * ⚠️ SE RESUELVE ACA Y NO EN LA PANTALLA. Sin esto, `/comprar` y `/carrito`
   * no podian decir "envío incluido" ni "a cargo del comprador" sin
   * inventarlo, y una pantalla que interpreta `shipping_mode` a mano es una
   * pantalla que el dia que el enum crezca dice algo que no es.
   */
  shipping: ShippingSummary;
}

/**
 * Ficha publica por id. No exige sesion: es parte de la vitrina.
 *
 * Devuelve `null` si la publicacion no existe **o no es comprable**: quien
 * tenga un enlace viejo no deberia poder ver lo que la vitrina esconde.
 */
export async function findPublicListing(id: string): Promise<PublicListingDetail | null> {
  /*
   * ⚠️ UN ID QUE NO ES UUID ES "NO ENCONTRADO", NO UNA EXCEPCION. `listings.id`
   * es `uuid` y PostgreSQL RECHAZA la comparacion contra un texto mal formado
   * (`invalid input syntax for type uuid`). Sin esta guarda, `/p/cualquier-cosa`
   * no devolvia la ficha de "no encontrada": tiraba un error de base que quedaba
   * registrado en el log del servidor, y encima gastaba la consulta para eso.
   * Verificado contra un build de produccion.
   */
  if (!esUuid(id)) return null;

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
    playerName: row.playerName,
    playerNumber: row.playerNumber,
    authenticity: row.authenticity,
    stock: row.stock,
    sellerDisplayName: row.sellerDisplayName,
    sellerId: row.sellerId,
    sellerUsername: row.sellerUsername,
    shipping: shippingSummaryFor(row),
    // La ficha usa la variante grande; la portada del detalle es la primera.
    coverUrl: imagenes[0] === undefined ? null : urlDeVariante(imagenes[0], 'medium'),
    coverSrcSet: imagenes[0] === undefined ? null : srcSetDe(imagenes[0]),
    /*
     * ⚠️ LA GALERIA TAMBIEN VIAJA CON `srcset`. Eran hasta ocho fotos servidas
     * SIEMPRE en `large` (1600px) —en la ficha, que es la pantalla mas
     * compartida y la que mas se abre desde un telefono—. `large` sigue siendo
     * el `src` de respaldo; el navegador elige con el resto.
     */
    images: imagenes.flatMap((imagen) => {
      const url = urlDeVariante(imagen, 'large');

      return url === null ? [] : [{ url, srcSet: srcSetDe(imagen), alt: imagen.alt }];
    }),
  };
}

/** Lo que la ficha ofrece despues de la publicacion que se esta mirando. */
export interface RelatedListings {
  /** Otras del MISMO vendedor. Aprovecha un envio ya iniciado. */
  delVendedor: CatalogListing[];
  /** Parecidas, de OTROS vendedores. */
  similares: CatalogListing[];
}

/**
 * Cuantas entran en cada fila. Cuatro es exactamente una fila de la grilla en
 * escritorio: dos filas de "relacionadas" empujarian las preguntas —que son el
 * ultimo bloque antes de decidir— fuera de la pantalla.
 */
const TOPE_DE_RELACIONADAS = 4;

/**
 * Que mas mirar a partir de una publicacion (SS-020 / PS-021).
 *
 * ⚠️ LA FICHA ERA UN CALLEJON SIN SALIDA. Terminaba en las preguntas: quien no
 * se decidia por ESA camiseta no tenia a donde ir sin volver atras. Es la
 * palanca de conversion mas comun del rubro y no existia.
 *
 * ⚠️ NUNCA VOLTEA LA FICHA. Devuelve listas vacias ante cualquier fallo, igual
 * que las preguntas y la reputacion: es un bloque accesorio de la pantalla mas
 * compartida del sitio, y lo que la sostiene es la publicacion.
 *
 * ⚠️ LAS PORTADAS DE LAS DOS LISTAS SALEN EN UNA SOLA CONSULTA. Pedirlas por
 * seccion serian dos viajes para lo mismo, y de a una serian ocho.
 */
export async function relatedListings(listingId: string): Promise<RelatedListings> {
  const vacio: RelatedListings = { delVendedor: [], similares: [] };

  if (!esUuid(listingId)) return vacio;

  try {
    const row = await listingRepo.findById(listingId);
    if (row === undefined) return vacio;

    const [delVendedor, similares] = await Promise.all([
      listingRepo.findMoreFromSeller(row.sellerId, row.id, TOPE_DE_RELACIONADAS),
      listingRepo.findSimilar(
        {
          listingId: row.id,
          sellerId: row.sellerId,
          categoryId: row.categoryId,
          clubId: row.clubId,
          nationalTeamId: row.nationalTeamId,
          brandId: row.brandId,
        },
        TOPE_DE_RELACIONADAS,
      ),
    ]);

    const portadas = await coverImages([...delVendedor, ...similares].map((fila) => fila.id));
    const conPortada = (filas: listingRepo.CatalogListingRow[]): CatalogListing[] =>
      filas.map((fila) => toCatalogListing(fila, portadas.get(fila.id) ?? null));

    return { delVendedor: conPortada(delVendedor), similares: conPortada(similares) };
  } catch (error) {
    console.error('[listings] no se pudieron leer las relacionadas', error);

    return vacio;
  }
}

/** Una pagina del catalogo publico de un vendedor. */
export interface SellerCatalogPage {
  listings: CatalogListing[];
  total: number;
  pagina: number;
  paginas: number;
}

/** Cuantas publicaciones entran en una pagina de la tienda publica. */
const POR_PAGINA_DE_TIENDA = 24;

/**
 * El catalogo VISIBLE de un vendedor, paginado: la tienda publica (SS-020).
 *
 * ⚠️ USA EL MISMO FILTRO QUE LA VITRINA, asi que un vendedor desconectado de
 * Mercado Pago, de vacaciones o sancionado tiene la tienda VACIA, no
 * escondida: la pagina existe y explica por que no hay nada. Esconder la
 * tienda entera dejaria un enlace roto en cada ficha que alguien compartio.
 */
export async function listPublicSellerCatalog(
  sellerId: string,
  opciones: { pagina?: number } = {},
): Promise<SellerCatalogPage> {
  const pagina = Math.max(1, Math.trunc(opciones.pagina ?? 1));

  const [filas, total] = await Promise.all([
    listingRepo.findPublicBySellerId(sellerId, {
      limite: POR_PAGINA_DE_TIENDA,
      offset: (pagina - 1) * POR_PAGINA_DE_TIENDA,
      promotedFirst: true,
    }),
    listingRepo.countPublicBySellerId(sellerId),
  ]);

  const portadas = await coverImages(filas.map((fila) => fila.id));

  return {
    listings: filas.map((fila) => toCatalogListing(fila, portadas.get(fila.id) ?? null)),
    total,
    pagina,
    paginas: Math.max(1, Math.ceil(total / POR_PAGINA_DE_TIENDA)),
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

/** Una entrada de catalogo tal como la vitrina la muestra: sin alias ni banderas internas. */
/**
 * Una entrada de catalogo por su slug, para `/club/[slug]` y `/marca/[slug]`.
 *
 * ⚠️ DEVUELVE `null` EN VEZ DE LANZAR: la pantalla decide el 404. Un slug que no
 * existe es una URL vieja o mal tipeada, no un error del sistema.
 */
export async function entradaDeCatalogoPorSlug(
  catalogo: catalogRepo.NombreDeCatalogo,
  slug: string,
): Promise<EntradaDeCatalogo | null> {
  const fila = await catalogRepo.findActiveBySlug(catalogo, slug);

  return fila === undefined ? null : { id: fila.id, nombre: fila.name, slug: fila.slug };
}

export interface EntradaDeCatalogo {
  id: string;
  nombre: string;
  slug: string;
}

/**
 * El catalogo controlado completo, para la vitrina.
 */
export interface CatalogoDeLaVitrina {
  clubes: EntradaDeCatalogo[];
  marcas: EntradaDeCatalogo[];
  temporadas: EntradaDeCatalogo[];
  categorias: PublicCategory[];
}

/**
 * Clubes, marcas, temporadas y categorias del catalogo controlado, en orden
 * alfabetico.
 *
 * ⚠️ SON DATOS REALES Y SIEMPRE EXISTEN: las tablas las siembran las
 * migraciones 0004 y 0007 (PS-023), asi que la home puede mostrar algo
 * verdadero aunque la vitrina tenga una sola publicacion o ninguna. Antes cada
 * seccion de la home dependia de las facetas de la busqueda —que se calculan
 * sobre lo PUBLICADO— y un marketplace recien abierto quedaba con la portada y
 * un hueco. El catalogo no dice cuantas camisetas hay de cada club: dice que
 * clubes existen para buscar, que es lo que un atajo necesita.
 */
export async function catalogoDeLaVitrina(): Promise<CatalogoDeLaVitrina> {
  const [clubes, marcas, temporadas, categorias] = await Promise.all([
    catalogRepo.findActive('club'),
    catalogRepo.findActive('brand'),
    catalogRepo.findActive('season'),
    listActiveCategories(),
  ]);

  const publica = (fila: catalogRepo.CatalogRow): EntradaDeCatalogo => ({
    id: fila.id,
    nombre: fila.name,
    slug: fila.slug,
  });

  return {
    clubes: clubes.map(publica),
    marcas: marcas.map(publica),
    temporadas: temporadas.map(publica),
    categorias,
  };
}
