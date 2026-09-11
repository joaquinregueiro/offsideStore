import type { Database } from '@offside/database';

import { precio as formatearPrecio } from '../../../lib/formato';
import type { PublicUser } from '../../auth/services/auth.service';
import { parseSettingValue } from '../../config/services/settings-registry';
import { coverUrls } from '../../listings/services/listing.service';
import * as inapp from '../../notifications/services/inapp-notification.service';
import * as errors from '../favorites.errors';
import * as favoriteRepo from '../repositories/favorite.repository';

/**
 * Favoritos (BS-050) y sus avisos (BS-051).
 *
 * Un favorito es una fila `(user_id, listing_id)` con UNIQUE (ERD §10): no
 * reserva stock, no congela precio, no expira. Lo unico que agrega este
 * Service son las reglas de alrededor: que la publicacion exista, que la
 * lista muestre si HOY se puede comprar, y los avisos de precio y de agotado.
 *
 * ⚠️ BS-051 ES "SHOULD" Y SU ALCANCE SIGUE 🟡 (`buyer-system.md` §9: "avisos
 * de favoritos — alcance"). Se implementan los dos avisos que la regla
 * nombra —baja de precio y agotado— como notificaciones IN-APP, que es el
 * canal que ya existe; ningun email. El umbral de la baja es ⚙️
 * (`favorites_price_drop_min_percent`, migracion `0011`) y se lee del Config
 * Store en cada llamada, nunca de una constante.
 *
 * ⚠️ ESTE SERVICE NO SE ENTERA SOLO DE LOS CAMBIOS DE PRECIO NI DEL STOCK.
 * Quien edita el precio es `listings/listing-editing.service.ts` y quien
 * agota es `listings.markSoldOut()`; ninguno de los dos importa este modulo
 * todavia. Las dos funciones de abajo —`recordPriceDrop` y
 * `notifySoldOutToFavorites`— existen para que `listings` las llame; hasta
 * que lo haga, los avisos no se disparan solos.
 */

/** Tamaño de pagina de "Mis favoritos". Limite de UI, no regla de negocio. */
export const FAVORITOS_POR_PAGINA = 24;

/** Clave del Config Store con la baja minima para avisar (⚙️, migracion `0011`). */
export const PRICE_DROP_MIN_PERCENT_KEY = 'favorites_price_drop_min_percent';

/** Un favorito tal como lo pinta la lista. */
export interface PublicFavorite {
  listingId: string;
  title: string;
  /** Centavos como string: el dinero es `bigint` y un `number` no lo representa. */
  priceAmount: string;
  currency: string;
  sizeValue: string;
  condition: favoriteRepo.FavoriteListingRow['condition'];
  status: favoriteRepo.FavoriteListingRow['status'];
  stock: number;
  sellerDisplayName: string;
  /** Si HOY se puede comprar (ERD §9.1 + SS-013). La lista NO filtra: avisa. */
  comprable: boolean;
  coverUrl: string | null;
  /** Cuando se guardo. */
  favoritedAt: string;
  /** Precio al guardar, si la publicacion cambio de precio desde entonces. */
  precioAlGuardar: string | null;
  /** Cuesta menos que cuando se guardo. */
  bajoDePrecio: boolean;
}

export interface FavoritesPage {
  favoritos: PublicFavorite[];
  total: number;
  pagina: number;
  porPagina: number;
}

/**
 * Agrega o quita de favoritos, segun estuviera. Devuelve el estado final.
 *
 * ES UN TOGGLE Y NO DOS FUNCIONES porque es lo que hace el boton: un corazon
 * que se toca. `UNIQUE(user_id, listing_id)` mas `ON CONFLICT DO NOTHING`
 * hacen que dos toques rapidos no puedan fallar ni duplicar.
 *
 * Se puede guardar una publicacion pausada o agotada —la persona quiere que
 * le avisen cuando vuelva—, pero no una eliminada: `deleted` es terminal y la
 * tarjeta no llevaria a ningun lado.
 */
export async function toggleFavorite(
  user: PublicUser,
  listingId: string,
): Promise<{ favorito: boolean }> {
  const listing = await favoriteRepo.findListingOwner(listingId);
  if (listing === undefined || listing.status === 'deleted') throw errors.listingNotFound();

  const agregado = await favoriteRepo.insert(user.id, listingId);
  if (agregado) return { favorito: true };

  await favoriteRepo.remove(user.id, listingId);

  return { favorito: false };
}

export async function isFavorite(user: PublicUser, listingId: string): Promise<boolean> {
  return (await favoriteRepo.find(user.id, listingId)) !== undefined;
}

/** Cuanta gente guardo la publicacion. Para la ficha ("N personas la guardaron"). */
/** Cuantas publicaciones guardo esta persona. Para la barra lateral. */
export async function countFavoritesOf(user: PublicUser): Promise<number> {
  return favoriteRepo.countByUserId(user.id);
}

export async function countFavorites(listingId: string): Promise<number> {
  return favoriteRepo.countByListingId(listingId);
}

/**
 * De estas publicaciones, cuales tiene el usuario en favoritos.
 *
 * Es lo que la grilla necesita para pintar el corazon: UNA consulta por
 * pagina de resultados. Devuelve un `Set` porque quien llama pregunta por id.
 */
export async function favoriteIdsOf(user: PublicUser, listingIds: string[]): Promise<Set<string>> {
  return new Set(await favoriteRepo.findListingIdsByUserId(user.id, listingIds));
}

/**
 * "Mis favoritos", paginado, mas reciente primero.
 *
 * ⚠️ NO FILTRA LO QUE NO SE PUEDE COMPRAR. Una pausada, agotada o de un
 * vendedor desconectado sigue en la lista marcada `comprable: false`: es
 * exactamente lo que BS-051 quiere que la persona vea. Solo se excluyen las
 * eliminadas, que no llevan a ningun lado.
 */
export async function listFavorites(user: PublicUser, pagina?: number): Promise<FavoritesPage> {
  const paginaValida = inapp.normalizarPagina(pagina);

  const [filas, total] = await Promise.all([
    favoriteRepo.findByUserIdWithListing(user.id, {
      limite: FAVORITOS_POR_PAGINA,
      offset: (paginaValida - 1) * FAVORITOS_POR_PAGINA,
    }),
    favoriteRepo.countListableByUserId(user.id),
  ]);

  // Las portadas salen de `listings` en UNA consulta para toda la pagina,
  // por el mismo motivo que la vitrina: pedirlas de a una es N+1.
  const portadas = await coverUrls(filas.map((f) => f.listingId));

  return {
    favoritos: filas.map((fila) => ({
      listingId: fila.listingId,
      title: fila.title,
      priceAmount: fila.priceAmount.toString(),
      currency: fila.currency,
      sizeValue: fila.sizeValue,
      condition: fila.condition,
      status: fila.status,
      stock: fila.stock,
      sellerDisplayName: fila.sellerDisplayName,
      comprable: fila.comprable,
      coverUrl: portadas.get(fila.listingId) ?? null,
      favoritedAt: fila.favoritedAt.toISOString(),
      precioAlGuardar: fila.precioAlGuardar === null ? null : fila.precioAlGuardar.toString(),
      bajoDePrecio: fila.precioAlGuardar !== null && fila.priceAmount < fila.precioAlGuardar,
    })),
    total,
    pagina: paginaValida,
    porPagina: FAVORITOS_POR_PAGINA,
  };
}

/* -------------------------------------------------------------------------- */
/* Avisos (BS-051)                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Cuanto bajo el precio, en BASIS POINTS del precio anterior (1.000 = 10 %).
 *
 * ⚠️ FUNCION PURA, en `bigint`, sin `float`: es la misma regla que
 * `calculateCommission` en `orders`. Se compara contra el umbral en basis
 * points (`porcentaje * 100`) para que un umbral con decimales —`12.5`— no
 * obligue a dividir en punto flotante. Redondea hacia ABAJO: una baja de
 * 9,99 % con umbral 10 % no avisa.
 */
export function priceDropBasisPoints(oldPrice: bigint, newPrice: bigint): number {
  if (oldPrice <= 0n) throw errors.invalidPriceDrop('el precio anterior tiene que ser positivo');
  if (newPrice < 0n) throw errors.invalidPriceDrop('el precio nuevo no puede ser negativo');
  if (newPrice >= oldPrice) return 0;

  return Number(((oldPrice - newPrice) * 10_000n) / oldPrice);
}

/** Umbral en basis points a partir del porcentaje del Config Store. */
export function thresholdBasisPoints(minPercent: number): number {
  return Math.round(minPercent * 100);
}

async function minPriceDropBasisPoints(db?: Database): Promise<number> {
  const crudo = await favoriteRepo.findGlobalSetting(PRICE_DROP_MIN_PERCENT_KEY, db);
  if (crudo === undefined) throw errors.settingNotConfigured(PRICE_DROP_MIN_PERCENT_KEY);

  return thresholdBasisPoints(parseSettingValue(PRICE_DROP_MIN_PERCENT_KEY, crudo));
}

/**
 * Avisa a quienes tienen la publicacion en favoritos que bajo de precio.
 *
 * Lo llama `listings` cuando el vendedor cambia el precio (SS-041); no se
 * dispara solo. Devuelve cuantas personas recibieron el aviso: 0 si la baja
 * no llega al umbral ⚙️ o si nadie la tenia guardada. Una SUBA no avisa
 * nunca.
 *
 * Recibe `db` para que `listings` pueda llamarlo desde la MISMA transaccion
 * en la que escribe el precio: si esa escritura se revierte, el aviso no
 * queda contando una baja que no paso.
 *
 * `type = 'price_alert'`: es el valor del enum cerrado `notification_type`
 * (ERD §3) que existe para esto. El `payload` lleva los dos importes como
 * string de centavos, igual que todo el dinero que sale del dominio.
 */
export async function recordPriceDrop(
  listingId: string,
  oldPrice: bigint,
  newPrice: bigint,
  db?: Database,
): Promise<number> {
  const bajaBp = priceDropBasisPoints(oldPrice, newPrice);
  if (bajaBp === 0) return 0;

  if (bajaBp < (await minPriceDropBasisPoints(db))) return 0;

  const listing = await favoriteRepo.findListingOwner(listingId, db);
  if (listing === undefined) return 0;

  const userIds = await favoriteRepo.findUserIdsByListingId(listingId, db);
  if (userIds.length === 0) return 0;

  return inapp.notifyMany(
    userIds,
    {
      type: 'price_alert',
      title: `Bajó de precio: ${listing.title}`,
      body: `Pasó de ${formatearPrecio(oldPrice.toString(), listing.currency)} a ${formatearPrecio(newPrice.toString(), listing.currency)}.`,
      payload: {
        kind: 'price_drop',
        listingId,
        oldPrice: oldPrice.toString(),
        newPrice: newPrice.toString(),
        currency: listing.currency,
      },
    },
    db,
  );
}

/**
 * Avisa a quienes tienen la publicacion en favoritos que se agoto.
 *
 * Lo llama `listings` cuando la ultima unidad se vende (SS-051,
 * `markSoldOut`). Va como `type = 'system'` con `payload.kind`: el enum
 * cerrado no tiene un valor para "agotado" y `price_alert` es de precio;
 * inventar un tipo es un cambio de esquema. ASUMIDO.
 */
export async function notifySoldOutToFavorites(listingId: string, db?: Database): Promise<number> {
  const listing = await favoriteRepo.findListingOwner(listingId, db);
  if (listing === undefined) return 0;

  const userIds = await favoriteRepo.findUserIdsByListingId(listingId, db);
  if (userIds.length === 0) return 0;

  return inapp.notifyMany(
    userIds,
    {
      type: 'system',
      title: `Se agotó: ${listing.title}`,
      body: 'Una publicación que guardaste en favoritos ya no tiene stock.',
      payload: { kind: 'favorite_sold_out', listingId },
    },
    db,
  );
}

/**
 * La firma que `listings` ofrece para enterarse de una baja de precio
 * (`registerPriceDropListener(fn)`), lista para registrar:
 *
 *   registerPriceDropListener(favoriteService.priceDropListener);
 */
export const priceDropListener = async (
  listingId: string,
  oldPrice: bigint,
  newPrice: bigint,
): Promise<void> => {
  await recordPriceDrop(listingId, oldPrice, newPrice);
};
