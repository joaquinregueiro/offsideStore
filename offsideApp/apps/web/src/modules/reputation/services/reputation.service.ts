import { getDatabase, type Database } from '@offside/database';

import { CAPABILITIES, hasCapability } from '@/lib/permissions';

import * as audit from '../../audit/services/audit.service';
import type { PublicUser } from '../../auth/services/auth.service';
import * as historyRepo from '../repositories/history.repository';
import * as orderFactsRepo from '../repositories/order-facts.repository';
import * as reputationRepo from '../repositories/reputation.repository';
import * as levelRepo from '../repositories/user-level.repository';
import * as errors from '../reputation.errors';
import { computeScore, scoreToColumn } from './reputation-score';
import {
  getDispatchDeadlineHours,
  getScoreWeights,
  getUserLevelThresholds,
} from './reputation-settings.service';
import {
  decideLevelChange,
  LEVEL_EVENT_TYPES,
  reputationLabel,
  type LevelChangeReason,
  type UserLevel,
} from './user-level-rules';

/**
 * REPUTACION DEL VENDEDOR y NIVEL DE USUARIO (trust-and-safety.md §4.3 y
 * §4.6; DEC-020 / DEC-022 / DEC-036).
 *
 * Tres ideas sostienen este Service:
 *
 *  1. `user_history_events` ES LA FUENTE DE VERDAD (DEC-036). Los hooks de
 *     abajo EMITEN hechos ahi; `seller_reputations` y `users.user_level` se
 *     RECOMPUTAN desde ahi. Si manana cambia una formula, se recalcula todo
 *     y nada se pierde: ninguna de las dos proyecciones es autoridad.
 *  2. El SCORE es derivado y NO decide nada (TS-020/021). Se guarda para
 *     ordenar y analizar; al lado van siempre las metricas crudas.
 *  3. NIVEL DE USUARIO, RIESGO y TIER son ejes distintos (DEC-022). Aca se
 *     toca el nivel; el riesgo es de `trust` y el tier de `sellers`.
 *
 * ⚠️ IDEMPOTENCIA. Los hooks se llaman desde transiciones de orden que se
 * reintentan (webhooks, jobs). Emitir es `appendFactIfMissing`, recomputar es
 * un upsert completo y el nivel solo sube cuando cruza un umbral: llamar dos
 * veces deja el mismo resultado que una.
 *
 * ⚠️ BR-051 (anti autocompra). Una orden en la que comprador y vendedor son
 * el mismo usuario NO emite hechos: no cuenta como venta, ni como compra, ni
 * mueve el nivel. `orders` hoy no la rechaza al crearla, asi que la guarda
 * vive aca, en el punto donde el hecho se volveria reputacion.
 */

/* -------------------------------------------------------------------------- */
/* Recomputo de seller_reputations                                            */
/* -------------------------------------------------------------------------- */

export interface SellerReputationSnapshot {
  sellerId: string;
  salesCount: number;
  cancellationsCount: number;
  claimsCount: number;
  refundsCount: number;
  avgDispatchHours: number | null;
  /**
   * Fraccion 0..1 de despachos dentro del plazo (BR-032), o `null` sin
   * despachos medidos. ⚠️ NO SE PERSISTE: `seller_reputations` no tiene la
   * columna; se calcula al recomputar y al leer.
   */
  onTimeDispatchRate: number | null;
  dispatchedCount: number;
  ratingAvg: number | null;
  ratingCount: number;
  /** Derivado, NO autoridad (DEC-036). */
  score: number | null;
  computedAt: Date;
}

function redondear2(valor: number): number {
  return Math.round(valor * 100) / 100;
}

function tasaPuntualidad(t: reputationRepo.DispatchTimeliness): number | null {
  return t.measured > 0 ? t.onTime / t.measured : null;
}

/**
 * Proyecta `seller_reputations` desde el historial, las ordenes, las reviews,
 * las disputas y los envios, y la escribe con `computed_at`.
 *
 * Que alimenta cada contador (ERD §7.4 / trust-and-safety §4.3):
 *
 *   sales_count          hechos SALE_COMPLETED con rol vendedor
 *   cancellations_count  hechos ORDER_CANCELLED con `cancelledBy = 'seller'`
 *   claims_count         disputas contra el vendedor, en cualquier estado
 *   refunds_count        reembolsos COMPLETED sobre sus ordenes
 *   avg_dispatch_hours   promedio de `shipments.dispatched_at - orders.paid_at`
 *   rating_avg / count   promedio y cantidad de `reviews`
 *
 * `counterfeit_flags` no se toca (TS-022 sigue 🟡, ver el repository).
 */
export async function recomputeSellerReputation(
  sellerId: string,
  db?: Database,
): Promise<SellerReputationSnapshot> {
  const ejecutar = async (tx: Database): Promise<SellerReputationSnapshot> => {
    const sellerUserId = await reputationRepo.findSellerUserId(sellerId, tx);
    if (sellerUserId === undefined) throw errors.sellerNotFound();

    const [
      salesCount,
      cancellationsCount,
      claimsCount,
      refundsCount,
      avgDispatchHours,
      ratings,
      weights,
      dispatchDeadlineHours,
    ] = await Promise.all([
      historyRepo.countEvents(sellerUserId, ['SALE_COMPLETED'], 'seller', tx),
      historyRepo.countSellerCancellations(sellerUserId, tx),
      reputationRepo.countDisputes(sellerId, tx),
      reputationRepo.countCompletedRefunds(sellerId, tx),
      reputationRepo.averageDispatchHours(sellerId, tx),
      reputationRepo.aggregateRatings(sellerId, tx),
      getScoreWeights(tx),
      getDispatchDeadlineHours(tx),
    ]);

    const puntualidad = await reputationRepo.dispatchTimeliness(
      sellerId,
      dispatchDeadlineHours,
      tx,
    );

    const score = computeScore(
      {
        salesCount,
        cancellationsCount,
        claimsCount,
        avgDispatchHours,
        ratingAvg: ratings.ratingAvg,
        ratingCount: ratings.ratingCount,
        dispatchDeadlineHours,
      },
      weights,
    );

    const computedAt = new Date();
    const avgRedondeado = avgDispatchHours === null ? null : redondear2(avgDispatchHours);
    const ratingRedondeado = ratings.ratingAvg === null ? null : redondear2(ratings.ratingAvg);

    await reputationRepo.upsert(
      {
        sellerId,
        salesCount,
        cancellationsCount,
        claimsCount,
        refundsCount,
        avgDispatchHours: avgRedondeado === null ? null : avgRedondeado.toFixed(2),
        ratingAvg: ratingRedondeado === null ? null : ratingRedondeado.toFixed(2),
        ratingCount: ratings.ratingCount,
        score: scoreToColumn(score),
        computedAt,
      },
      tx,
    );

    return {
      sellerId,
      salesCount,
      cancellationsCount,
      claimsCount,
      refundsCount,
      avgDispatchHours: avgRedondeado,
      onTimeDispatchRate: tasaPuntualidad(puntualidad),
      dispatchedCount: puntualidad.measured,
      ratingAvg: ratingRedondeado,
      ratingCount: ratings.ratingCount,
      score,
      computedAt,
    };
  };

  return db === undefined ? getDatabase().transaction(ejecutar) : ejecutar(db);
}

/* -------------------------------------------------------------------------- */
/* Lectura para la ficha, el perfil publico y el panel del vendedor            */
/* -------------------------------------------------------------------------- */

export interface SellerReputationView extends SellerReputationSnapshot {
  sellerDisplayName: string;
  counterfeitFlags: number;
  /** Los otros dos ejes (TS-021): se muestran al lado, nunca se mezclan. */
  userLevel: UserLevel;
  riskLevel: 'NORMAL' | 'RIESGO' | 'RESTRINGIDO' | 'SUSPENDIDO';
  /** "Nuevo" con pocas ventas; despues, el nombre del nivel (DEC-020). */
  label: string;
}

const numeroONull = (valor: string | null): number | null =>
  valor === null ? null : Number(valor);

/**
 * Metricas crudas + score + etiqueta. Si la proyeccion no existe todavia
 * (vendedor sin ningun hecho), se calcula en el momento: es cache derivado,
 * asi que materializarla en la primera lectura no cambia ningun dato.
 */
export async function getSellerReputation(
  sellerId: string,
  db?: Database,
): Promise<SellerReputationView> {
  const sellerUser = await reputationRepo.findSellerUser(sellerId, db);
  if (sellerUser === undefined) throw errors.sellerNotFound();

  let fila = await reputationRepo.findBySellerId(sellerId, db);
  if (fila === undefined) {
    await recomputeSellerReputation(sellerId, db);
    fila = await reputationRepo.findBySellerId(sellerId, db);
  }
  if (fila === undefined) throw errors.sellerNotFound();

  const deadlineHours = await getDispatchDeadlineHours(db);
  const puntualidad = await reputationRepo.dispatchTimeliness(sellerId, deadlineHours, db);

  return {
    sellerId,
    sellerDisplayName: sellerUser.sellerDisplayName,
    salesCount: fila.salesCount,
    cancellationsCount: fila.cancellationsCount,
    claimsCount: fila.claimsCount,
    refundsCount: fila.refundsCount,
    avgDispatchHours: numeroONull(fila.avgDispatchHours),
    onTimeDispatchRate: tasaPuntualidad(puntualidad),
    dispatchedCount: puntualidad.measured,
    ratingAvg: numeroONull(fila.ratingAvg),
    ratingCount: fila.ratingCount,
    counterfeitFlags: fila.counterfeitFlags,
    score: numeroONull(fila.score),
    computedAt: fila.computedAt ?? new Date(0),
    userLevel: sellerUser.userLevel,
    riskLevel: sellerUser.riskLevel,
    label: reputationLabel(fila.salesCount, sellerUser.userLevel),
  };
}

/** Por conveniencia del panel: la misma vista, buscada por usuario. `null` si no es vendedor. */
export async function getSellerReputationForUser(
  userId: string,
  db?: Database,
): Promise<SellerReputationView | null> {
  const sellerId = await reputationRepo.findSellerIdByUserId(userId, db);
  if (sellerId === undefined) return null;

  return getSellerReputation(sellerId, db);
}

/* -------------------------------------------------------------------------- */
/* Nivel de usuario (DEC-020)                                                  */
/* -------------------------------------------------------------------------- */

export interface UserLevelEvaluation {
  userId: string;
  /** Compras + ventas completadas contadas (ver `LEVEL_EVENT_TYPES`). */
  operations: number;
  from: UserLevel;
  to: UserLevel;
  changed: boolean;
  reason: LevelChangeReason;
}

/**
 * Recalcula el nivel desde el historial y lo escribe si subio, con su fila en
 * `user_level_history` (`triggered_by = 'system'`). Ver las reglas en
 * `user-level-rules.ts`: TIENDA no se evalua y el nivel no baja solo.
 */
export async function evaluateUserLevel(
  userId: string,
  db?: Database,
): Promise<UserLevelEvaluation> {
  const ejecutar = async (tx: Database): Promise<UserLevelEvaluation> => {
    const usuario = await levelRepo.findUserLevel(userId, tx);
    if (usuario === undefined) throw errors.userNotFound();

    const [operations, thresholds] = await Promise.all([
      historyRepo.countEvents(userId, LEVEL_EVENT_TYPES, undefined, tx),
      getUserLevelThresholds(tx),
    ]);

    const decision = decideLevelChange(usuario.userLevel, operations, thresholds);
    const resultado: UserLevelEvaluation = { userId, operations, ...decision };

    if (!decision.changed) return resultado;

    // Si otra evaluacion concurrente ya lo subio, esta no escribe historial
    // duplicado: el UPDATE condicionado no toca ninguna fila.
    const escrito = await levelRepo.updateUserLevel(userId, decision.from, decision.to, tx);
    if (!escrito) return { ...resultado, changed: false, reason: 'sin_cambio' };

    await levelRepo.insertLevelHistory(
      {
        userId,
        fromValue: decision.from,
        toValue: decision.to,
        reason: `Umbral alcanzado: ${operations} operaciones completadas`,
        triggeredBy: 'system',
        adminId: null,
      },
      tx,
    );

    return resultado;
  };

  return db === undefined ? getDatabase().transaction(ejecutar) : ejecutar(db);
}

/** Largo maximo del motivo que queda en `user_level_history.reason` y en `audit_log`. */
export const LEVEL_REASON_MAX_LENGTH = 500;

/**
 * Otorga TIENDA (DEC-020: "categoria especial otorgada por Offside").
 *
 * ⚠️ CAPACIDAD: no existe una capacidad propia (`users:manage_level`) en
 * `lib/permissions.ts`, que no es de este paquete. Se exige
 * `system_config:manage` —ADMIN y SUPER_ADMIN, los mismos roles que cambian
 * reglas para toda la plataforma— hasta que se declare la propia. Cambiarla
 * es tocar UNA constante.
 *
 * Queda en `user_level_history` (`triggered_by = 'admin'`, con `admin_id`) y
 * en `audit_log` (BR-052): la primera es la serie del nivel, el segundo es
 * la decision administrativa con su motivo.
 */
export async function grantTiendaLevel(
  adminUser: PublicUser,
  userId: string,
  motivo: string,
  db?: Database,
): Promise<{ userId: string; from: UserLevel; to: 'TIENDA'; changed: boolean }> {
  /*
   * ⚠️ ES `trust:moderate` Y NO `system_config:manage`. Otorgar TIENDA es una
   * decision sobre la CONFIANZA de una cuenta (DEC-020), no un cambio de
   * configuracion del marketplace, y se opera desde la pantalla de moderacion
   * de vendedores. Hoy los dos mapas dan los mismos roles; el dia que se
   * separen, esta pantalla no puede mostrar un formulario que el servidor
   * rechaza.
   */
  if (!hasCapability(adminUser.adminRole, CAPABILITIES.TRUST_MODERATE)) {
    throw errors.levelGrantForbidden();
  }

  const razon = motivo.trim();
  if (razon.length === 0) throw errors.reasonRequired();
  if (razon.length > LEVEL_REASON_MAX_LENGTH) throw errors.reasonTooLong(LEVEL_REASON_MAX_LENGTH);

  const ejecutar = async (tx: Database) => {
    const usuario = await levelRepo.findUserLevel(userId, tx);
    if (usuario === undefined) throw errors.userNotFound();

    if (usuario.userLevel === 'TIENDA') {
      return { userId, from: usuario.userLevel, to: 'TIENDA' as const, changed: false };
    }

    const escrito = await levelRepo.updateUserLevel(userId, usuario.userLevel, 'TIENDA', tx);
    if (!escrito) {
      return { userId, from: usuario.userLevel, to: 'TIENDA' as const, changed: false };
    }

    await levelRepo.insertLevelHistory(
      {
        userId,
        fromValue: usuario.userLevel,
        toValue: 'TIENDA',
        reason: razon,
        triggeredBy: 'admin',
        adminId: adminUser.id,
      },
      tx,
    );

    await audit.record(
      {
        actorType: 'admin',
        actorId: adminUser.id,
        action: 'user_level.grant_tienda',
        entityType: 'user',
        entityId: userId,
        before: { userLevel: usuario.userLevel },
        after: { userLevel: 'TIENDA' },
        metadata: { motivo: razon },
      },
      tx,
    );

    return { userId, from: usuario.userLevel, to: 'TIENDA' as const, changed: true };
  };

  return db === undefined ? getDatabase().transaction(ejecutar) : ejecutar(db);
}

/* -------------------------------------------------------------------------- */
/* Hooks: los llaman orders, disputes y reviews cuando pasa el hecho           */
/* -------------------------------------------------------------------------- */

export interface OrderCompletedResult {
  orderId: string;
  /** BR-051: comprador y vendedor eran el mismo usuario; no se emitio nada. */
  selfOrder: boolean;
  saleFactEmitted: boolean;
  purchaseFactEmitted: boolean;
  reputation: SellerReputationSnapshot | null;
  buyerLevel: UserLevelEvaluation | null;
  sellerLevel: UserLevelEvaluation | null;
}

/**
 * La orden paso a `COMPLETED` (DEC-029). Emite SALE_COMPLETED al vendedor y
 * PURCHASE_COMPLETED al comprador, recomputa la reputacion del vendedor y
 * evalua el nivel de los dos.
 *
 * Se llama DESPUES de escribir la transicion, con la misma transaccion: si
 * el hecho no queda, la transicion tampoco. Repetirla es inocuo.
 */
export async function onOrderCompleted(
  orderId: string,
  db?: Database,
): Promise<OrderCompletedResult> {
  const ejecutar = async (tx: Database): Promise<OrderCompletedResult> => {
    const orden = await orderFactsRepo.findOrderFactContext(orderId, tx);
    if (orden === undefined) throw errors.orderNotFound();
    if (orden.status !== 'COMPLETED') {
      throw errors.orderNotInState(orderId, 'COMPLETED', orden.status);
    }

    if (orden.buyerId === orden.sellerUserId) {
      return {
        orderId,
        selfOrder: true,
        saleFactEmitted: false,
        purchaseFactEmitted: false,
        reputation: null,
        buyerLevel: null,
        sellerLevel: null,
      };
    }

    const data = {
      orderNumber: orden.orderNumber,
      totalAmount: orden.totalAmount.toString(),
      currency: orden.currency,
      completedAt: (orden.completedAt ?? new Date()).toISOString(),
    };

    const saleFactEmitted = await historyRepo.appendFactIfMissing(
      {
        userId: orden.sellerUserId,
        eventType: 'SALE_COMPLETED',
        role: 'seller',
        refEntityType: 'order',
        refEntityId: orderId,
        data,
      },
      tx,
    );

    const purchaseFactEmitted = await historyRepo.appendFactIfMissing(
      {
        userId: orden.buyerId,
        eventType: 'PURCHASE_COMPLETED',
        role: 'buyer',
        refEntityType: 'order',
        refEntityId: orderId,
        data,
      },
      tx,
    );

    const reputation = await recomputeSellerReputation(orden.sellerId, tx);
    const sellerLevel = await evaluateUserLevel(orden.sellerUserId, tx);
    const buyerLevel = await evaluateUserLevel(orden.buyerId, tx);

    return {
      orderId,
      selfOrder: false,
      saleFactEmitted,
      purchaseFactEmitted,
      reputation,
      buyerLevel,
      sellerLevel,
    };
  };

  return db === undefined ? getDatabase().transaction(ejecutar) : ejecutar(db);
}

export interface OrderCancelledResult {
  orderId: string;
  selfOrder: boolean;
  /** Quien cancelo segun `order_status_history`; `unknown` si no hay fila. */
  cancelledBy: orderFactsRepo.CancellationActor | 'unknown';
  sellerFactEmitted: boolean;
  buyerFactEmitted: boolean;
  reputation: SellerReputationSnapshot | null;
}

/**
 * La orden paso a `CANCELLED`. Emite ORDER_CANCELLED a los dos con
 * `data.cancelledBy`, que es lo que distingue una cancelacion DEL vendedor
 * (baja su reputacion) de una del comprador o del sistema (no).
 */
export async function onOrderCancelled(
  orderId: string,
  db?: Database,
): Promise<OrderCancelledResult> {
  const ejecutar = async (tx: Database): Promise<OrderCancelledResult> => {
    const orden = await orderFactsRepo.findOrderFactContext(orderId, tx);
    if (orden === undefined) throw errors.orderNotFound();
    if (orden.status !== 'CANCELLED') {
      throw errors.orderNotInState(orderId, 'CANCELLED', orden.status);
    }

    const cancelledBy = (await orderFactsRepo.findCancellationActor(orderId, tx)) ?? 'unknown';

    if (orden.buyerId === orden.sellerUserId) {
      return {
        orderId,
        selfOrder: true,
        cancelledBy,
        sellerFactEmitted: false,
        buyerFactEmitted: false,
        reputation: null,
      };
    }

    const data = {
      orderNumber: orden.orderNumber,
      cancelledBy,
      cancelledAt: (orden.cancelledAt ?? new Date()).toISOString(),
    };

    const sellerFactEmitted = await historyRepo.appendFactIfMissing(
      {
        userId: orden.sellerUserId,
        eventType: 'ORDER_CANCELLED',
        role: 'seller',
        refEntityType: 'order',
        refEntityId: orderId,
        data,
      },
      tx,
    );

    const buyerFactEmitted = await historyRepo.appendFactIfMissing(
      {
        userId: orden.buyerId,
        eventType: 'ORDER_CANCELLED',
        role: 'buyer',
        refEntityType: 'order',
        refEntityId: orderId,
        data,
      },
      tx,
    );

    const reputation = await recomputeSellerReputation(orden.sellerId, tx);

    return {
      orderId,
      selfOrder: false,
      cancelledBy,
      sellerFactEmitted,
      buyerFactEmitted,
      reputation,
    };
  };

  return db === undefined ? getDatabase().transaction(ejecutar) : ejecutar(db);
}

/**
 * Se abrio una disputa contra el vendedor. El hecho `DISPUTE_OPENED` lo emite
 * el modulo `disputes` (`trust/services/history.service.ts` es su puerta);
 * aca solo se recomputa `claims_count`, que sale de la tabla `disputes`.
 */
export async function onDisputeOpened(
  sellerId: string,
  db?: Database,
): Promise<SellerReputationSnapshot> {
  return recomputeSellerReputation(sellerId, db);
}

/** Se resolvio una disputa: puede haber cambiado `refunds_count`. */
export async function onDisputeResolved(
  sellerId: string,
  db?: Database,
): Promise<SellerReputationSnapshot> {
  return recomputeSellerReputation(sellerId, db);
}

export interface ReviewReceivedFact {
  reviewId: string;
  orderId: string;
  sellerId: string;
  sellerUserId: string;
  rating: number;
}

/**
 * El comprador califico (BS-100). Emite REVIEW_RECEIVED al vendedor y
 * recomputa. Lo llama `reviews` dentro de su transaccion: la review y su
 * hecho se confirman juntos o no se confirman.
 */
export async function onReviewCreated(
  review: ReviewReceivedFact,
  db?: Database,
): Promise<SellerReputationSnapshot> {
  const ejecutar = async (tx: Database): Promise<SellerReputationSnapshot> => {
    await historyRepo.appendFactIfMissing(
      {
        userId: review.sellerUserId,
        eventType: 'REVIEW_RECEIVED',
        role: 'seller',
        refEntityType: 'review',
        refEntityId: review.reviewId,
        data: { orderId: review.orderId, rating: review.rating },
      },
      tx,
    );

    return recomputeSellerReputation(review.sellerId, tx);
  };

  return db === undefined ? getDatabase().transaction(ejecutar) : ejecutar(db);
}
