import { getDatabase, type Database } from '@offside/database';

import * as audit from '../../audit/services/audit.service';
import type { PublicUser } from '../../auth/services/auth.service';
import { CAPABILITIES, hasCapability } from '../../../lib/permissions';
import { requireOwnSellerProfile } from '../../sellers/services/seller.service';
import * as errors from '../listings.errors';
import * as listingRepo from '../repositories/listing.repository';
import * as promotionRepo from '../repositories/promotion.repository';
import { getPromotionSettings, arePromotionsEnabled } from './listing-settings.service';
import {
  commissionAmountFor,
  effectiveCommissionBasisPoints,
  isPromoted,
  multiplierToSnapshot,
  promotionEndsAt,
  snapshotToMultiplier,
} from './promotion-rules';

/**
 * Publicaciones PROMOCIONADAS (PS-021 "destacadas", business-model.md §5.3).
 *
 * La forma del cobro es la que el owner autorizo el 2026-09-10 y que el delta
 * de esquema documenta: **no se paga por adelantado, se paga con comision**.
 * Mientras la promocion esta vigente, una venta de esa publicacion cobra la
 * tasa del vendedor MULTIPLICADA por `promotion_commission_multiplier` (⚙️
 * Config Store; sembrado en 3, "el triple").
 *
 * ⚠️ TRES DECISIONES QUE SOSTIENEN TODO EL MODULO:
 *
 * 1. **El multiplicador se CONGELA al promocionar**, no al vender
 *    (`commission_multiplier_snapshot`). Si Admin lo sube de 3 a 4 el martes,
 *    la promocion que alguien contrato el lunes sigue cobrando 3: el vendedor
 *    acepto un numero y ese numero es el que rige. La orden vuelve a
 *    congelarlo en `promotion_multiplier_at_transaction` (DEC-030), asi que
 *    hay dos copias y ninguna se recalcula nunca.
 *
 * 2. **La promocion NO SE PUEDE CANCELAR ANTES DE TIEMPO** (asumido,
 *    2026-09-11, confirmar). Es la regla que evita el abuso obvio:
 *    promocionar para figurar primero, recibir las visitas y cancelar antes
 *    de vender para no pagar la comision agravada. Solo Admin puede
 *    terminarla, con motivo y auditoria.
 *
 * 3. **`promoted_until` es una PROYECCION, no la verdad.** La verdad es la
 *    fila de `listing_promotions`, que es historial. La columna existe para
 *    que la vitrina y la busqueda filtren y ordenen con un solo WHERE sin
 *    joinear. Misma forma que `SS-013` y que las vacaciones.
 */

/* -------------------------------------------------------------------------- */
/* Tipos publicos                                                              */
/* -------------------------------------------------------------------------- */

/** La promocion vigente, como la necesita `orders` para el snapshot. */
export interface ActivePromotion {
  id: string;
  /** `commission_multiplier_snapshot` ya convertido a numero. */
  multiplier: number;
  endsAt: Date;
}

/** Una fila del historial, para el panel del vendedor. */
export interface PublicPromotion {
  id: string;
  listingId: string;
  listingTitle: string;
  status: string;
  /** `3` = el triple. Es el snapshot, no el valor actual del Config Store. */
  multiplier: number;
  startsAt: string;
  endsAt: string;
  cancelledAt: string | null;
  vigente: boolean;
  /** Ordenes que se pagaron bajo esta promocion (no incluye canceladas). */
  ventas: number;
}

/**
 * Lo que le cuesta a un vendedor promocionar ESTA publicacion, con SU tasa.
 *
 * ⚠️ TODO EN CENTAVOS Y CALCULADO CON LA MISMA FUNCION QUE LA ORDEN. La
 * pantalla que le pregunta a alguien "¿promocionás?" tiene que mostrar el
 * mismo centavo que la venta va a cobrar: si la cotizacion redondeara distinto
 * que `calculateCommission`, la promesa y el cobro no coincidirian.
 */
export interface PromotionQuote {
  listingId: string;
  priceAmount: string;
  currency: string;
  /** Tasa sin promocion (la del tier del vendedor, o la global). */
  baseBasisPoints: number;
  /** Tasa con promocion, ya topeada en 10000. */
  promotedBasisPoints: number;
  multiplier: number;
  durationDays: number;
  /** Comision en centavos sobre el precio actual, sin promocion y con ella. */
  baseCommissionAmount: string;
  promotedCommissionAmount: string;
  /** La diferencia: lo que la promocion le cuesta si vende. */
  extraCommissionAmount: string;
}

/* -------------------------------------------------------------------------- */
/* Lecturas                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * La promocion vigente de una publicacion, o `null`.
 *
 * ⚠️ ES LA FUNCION QUE `orders` LLAMA AL CREAR LA ORDEN. Devuelve el id y el
 * multiplicador congelados, que van a `listing_promotion_id` y a
 * `promotion_multiplier_at_transaction`. Acepta `db` para correr dentro de la
 * transaccion que crea la orden.
 */
export async function activePromotionFor(
  listingId: string,
  at: Date = new Date(),
  db?: Database,
): Promise<ActivePromotion | null> {
  const fila = await promotionRepo.findActiveByListingId(listingId, at, db);
  if (fila === undefined) return null;

  return {
    id: fila.id,
    multiplier: snapshotToMultiplier(fila.commissionMultiplierSnapshot),
    endsAt: fila.endsAt,
  };
}

/**
 * Historial de promociones del vendedor, con cuantas ventas hizo cada una.
 *
 * ⚠️ EL CONTEO DE VENTAS ES UNA SOLA CONSULTA PARA TODAS (`countSalesByPromotionIds`),
 * no una por fila: el panel muestra hasta 50 y eso serian 50 viajes a la base.
 */
export async function listPromotions(user: PublicUser, limite = 50): Promise<PublicPromotion[]> {
  const seller = await requireOwnSellerProfile(user);
  const filas = await promotionRepo.findBySellerId(seller.id, limite);
  if (filas.length === 0) return [];

  const ventas = await promotionRepo.countSalesByPromotionIds(filas.map((fila) => fila.id));
  const titulos = await listingRepo.findTitlesByIds(filas.map((fila) => fila.listingId));
  const ahora = Date.now();

  return filas.map((fila) => ({
    id: fila.id,
    listingId: fila.listingId,
    listingTitle: titulos.get(fila.listingId) ?? 'Publicación eliminada',
    status: fila.status,
    multiplier: snapshotToMultiplier(fila.commissionMultiplierSnapshot),
    startsAt: fila.startsAt.toISOString(),
    endsAt: fila.endsAt.toISOString(),
    cancelledAt: fila.cancelledAt?.toISOString() ?? null,
    vigente: fila.status === 'active' && fila.endsAt.getTime() > ahora,
    ventas: ventas.get(fila.id) ?? 0,
  }));
}

/**
 * Cuanto costaria promocionar, con la tasa del vendedor.
 *
 * ⚠️ `baseBasisPoints` LLEGA POR PARAMETRO y no se lee acá. Es la tasa del
 * tier del vendedor, que resuelve `sellers.resolveCommissionBasisPoints`;
 * importarla desde `listings` crearia una dependencia circular —`sellers` ya
 * no depende de `listings`, pero `orders` depende de los dos— y ademas
 * obligaria a esta funcion a saber quien es el vendedor cuando quien la llama
 * ya lo sabe.
 */
export async function getPromotionQuote(
  listingId: string,
  baseBasisPoints: number,
): Promise<PromotionQuote> {
  const listing = await listingRepo.findById(listingId);
  if (listing === undefined) throw errors.listingNotFound();

  const settings = await getPromotionSettings();
  const promotedBasisPoints = effectiveCommissionBasisPoints(
    baseBasisPoints,
    settings.commissionMultiplier,
  );

  const base = commissionAmountFor(listing.priceAmount, baseBasisPoints);
  const promocionada = commissionAmountFor(listing.priceAmount, promotedBasisPoints);

  return {
    listingId,
    priceAmount: listing.priceAmount.toString(),
    currency: listing.currency,
    baseBasisPoints,
    promotedBasisPoints,
    multiplier: settings.commissionMultiplier,
    durationDays: settings.durationDays,
    baseCommissionAmount: base.toString(),
    promotedCommissionAmount: promocionada.toString(),
    extraCommissionAmount: (promocionada - base).toString(),
  };
}

/**
 * Las promocionadas vigentes de la vitrina, para la seccion de la home.
 *
 * ⚠️ USA EL MISMO FILTRO DE VISIBILIDAD QUE LA VITRINA (`findPublicCatalog`):
 * una promocionada cuyo vendedor se desconecto de Mercado Pago, se fue de
 * vacaciones o esta sancionado NO aparece. Que alguien pague por figurar no
 * la vuelve comprable, y ofrecer lo que la compra rechaza es peor que no
 * ofrecerlo.
 */
export async function listPromotedCatalog(limite = 8): Promise<listingRepo.CatalogListingRow[]> {
  return listingRepo.findPublicCatalog({ limite, soloPromocionadas: true });
}

/* -------------------------------------------------------------------------- */
/* Escrituras                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * El vendedor promociona su publicacion.
 *
 * ⚠️ LA FILA Y LA PROYECCION VAN EN LA MISMA TRANSACCION. Si se escribiera la
 * promocion y fallara el `UPDATE listings`, existiria una promocion que cobra
 * comision agravada sobre una publicacion que nunca aparecio primera: le
 * cobrariamos por algo que no entregamos.
 */
export async function promoteListing(
  user: PublicUser,
  listingId: string,
): Promise<PublicPromotion> {
  if (!(await arePromotionsEnabled())) throw errors.promotionsDisabled();

  const seller = await requireOwnSellerProfile(user);
  const listing = await listingRepo.findById(listingId);

  // Una publicacion de OTRO vendedor no da "no es tuya": da lo mismo que una
  // que no existe. Distinguirlas convierte esta accion en un oraculo de que
  // ids existen.
  if (listing === undefined) throw errors.listingNotFound();
  if (listing.deletedAt !== null || listing.sellerId !== seller.id) {
    throw errors.listingNotFound();
  }

  // Solo lo que esta a la venta: promocionar una pausada o una agotada seria
  // cobrar por un lugar en una vitrina donde no aparece.
  if (listing.status !== 'active') throw errors.listingNotPromotable();

  const ahora = new Date();
  if (isPromoted({ promotedUntil: listing.promotedUntil }, ahora)) {
    throw errors.listingAlreadyPromoted();
  }

  const settings = await getPromotionSettings();
  const endsAt = promotionEndsAt(ahora, settings.durationDays);

  const fila = await getDatabase().transaction(async (tx) => {
    const promocion = await promotionRepo.insertPromotion(
      {
        listingId,
        sellerId: seller.id,
        commissionMultiplierSnapshot: multiplierToSnapshot(settings.commissionMultiplier),
        startsAt: ahora,
        endsAt,
        createdBy: user.id,
      },
      tx,
    );

    await promotionRepo.projectPromotedUntil(listingId, endsAt, ahora, tx);

    await audit.record(
      {
        actorType: 'seller',
        actorId: user.id,
        action: 'LISTING_PROMOTED',
        entityType: 'listing',
        entityId: listingId,
        after: {
          promotionId: promocion.id,
          multiplier: promocion.commissionMultiplierSnapshot,
          endsAt: endsAt.toISOString(),
        },
        metadata: { sellerId: seller.id, durationDays: settings.durationDays },
      },
      tx,
    );

    return promocion;
  });

  return {
    id: fila.id,
    listingId,
    listingTitle: listing.title,
    status: fila.status,
    multiplier: snapshotToMultiplier(fila.commissionMultiplierSnapshot),
    startsAt: fila.startsAt.toISOString(),
    endsAt: fila.endsAt.toISOString(),
    cancelledAt: null,
    vigente: true,
    ventas: 0,
  };
}

/**
 * Admin termina una promocion antes de tiempo.
 *
 * ⚠️ ES LA UNICA FORMA DE CORTARLA, y exige motivo. El vendedor NO puede: ver
 * la decision 2 del encabezado. La capacidad es `system_config:manage` porque
 * terminar una promocion cambia la comision que se le cobra a alguien, que es
 * exactamente lo que esa capacidad gobierna; cuando el mapa de DEC-023 crezca
 * puede pasar a una propia (asumido, confirmar).
 */
export async function endPromotionByAdmin(
  adminUser: PublicUser,
  promotionId: string,
  motivo: string,
): Promise<void> {
  if (!hasCapability(adminUser.adminRole, CAPABILITIES.SYSTEM_CONFIG_MANAGE)) {
    throw errors.promotionNotFound();
  }

  const razon = motivo.trim();
  if (razon.length === 0) throw errors.promotionReasonRequired();

  const promocion = await promotionRepo.findById(promotionId);
  if (promocion?.status !== 'active') throw errors.promotionNotFound();

  const ahora = new Date();

  await getDatabase().transaction(async (tx) => {
    const cortada = await promotionRepo.cancel(promotionId, ahora, tx);
    if (!cortada) throw errors.promotionNotFound();

    // La publicacion deja de estar promocionada YA: el predicado mira
    // `promoted_until`, asi que ponerlo en null la saca del primer lugar en la
    // vitrina y de la comision agravada en la proxima orden.
    await promotionRepo.projectPromotedUntil(promocion.listingId, null, null, tx);

    await audit.record(
      {
        actorType: 'admin',
        actorId: adminUser.id,
        action: 'LISTING_PROMOTION_ENDED',
        entityType: 'listing_promotion',
        entityId: promotionId,
        before: { status: 'active', endsAt: promocion.endsAt.toISOString() },
        after: { status: 'cancelled', cancelledAt: ahora.toISOString() },
        metadata: { listingId: promocion.listingId, sellerId: promocion.sellerId, motivo: razon },
      },
      tx,
    );
  });
}

/**
 * Barrido: pasa a `ended` las promociones vencidas. Idempotente.
 *
 * ⚠️ NO TOCA `promoted_until`, y no es un olvido: el predicado de la vitrina
 * es `now() < promoted_until`, asi que una vencida ya dejo de contar sola. La
 * columna queda como evidencia de que la publicacion estuvo promocionada,
 * igual que `promoted_at`.
 */
export async function expirePromotions(at: Date = new Date()): Promise<number> {
  return promotionRepo.endExpired(at);
}
