import { getDatabase, type Database } from '@offside/database';

import * as audit from '../../audit/services/audit.service';
import type { PublicUser } from '../../auth/services/auth.service';
import * as paymentRepo from '../../payments/repositories/payment.repository';
import { refundPayment } from '../../payments/services/refund.service';
import * as sellerRepo from '../../sellers/repositories/seller.repository';
import { applySanction } from '../../trust/services/sanction.service';
import { emitHistoryEvent } from '../../trust/services/history.service';
import * as errors from '../disputes.errors';
import * as disputeRepo from '../repositories/dispute.repository';
import { getClaimWindowSettings, getSellerResponseDays } from './dispute-settings.service';
import {
  buildTimeline,
  canResolve,
  canTransition,
  claimEligibility,
  isDisputeReason,
  isDisputeResolution,
  isOpen,
  normalizeDescription,
  normalizeEvidences,
  planResolution,
  resolutionLabel,
  sellerResponseDueFor,
  viewerRole,
  type DisputeTimelineEntry,
  type DisputeViewer,
} from './dispute-rules';

/**
 * RECLAMOS Y DISPUTAS (TS-050..061, DEC-009, ERD §16).
 *
 * Orquestacion pura: TODA la logica que se puede decidir sin base vive en
 * `dispute-rules.ts` —ventanas, transiciones, plan de resolucion, quien ve
 * que, normalizacion de evidencias y linea de tiempo— y esta probada sin
 * Postgres. Acá se lee, se escribe y se avisa.
 *
 * ⚠️ CUATRO DECISIONES QUE NO SE PUEDEN PERDER DE VISTA:
 *
 * 1. **Las evidencias son SOLO texto y URL.** El bucket de fotos es publico
 *    por diseño —sirve las imagenes de las publicaciones—, asi que subir ahi
 *    la foto de un DNI o de un paquete con una direccion seria una fuga con
 *    URL adivinable. Cuando exista almacenamiento privado se amplia; hasta
 *    entonces `normalizeEvidences` rechaza cualquier otra cosa.
 *
 * 2. **Quien resuelve no puede ser parte.** No alcanza con la capacidad
 *    `disputes:resolve`: un admin que ademas es el comprador o el vendedor de
 *    esa orden no puede resolver su propio reclamo (`canResolve`).
 *
 * 3. **Un refund rechazado por Mercado Pago NO deshace la resolucion.** La
 *    decision ya se tomo y queda escrita; lo que falla es el cobro. Se anota
 *    en `audit_log` y en las acciones, y NO se crea `seller_liabilities`: la
 *    deuda existe cuando Offside pago y el vendedor no, no cuando MP rechaza
 *    (ver el hueco conocido en CLAUDE.md §19).
 *
 * 4. **La sancion se aplica DESPUES del commit de la resolucion**, no dentro.
 *    `applySanction` abre su propia transaccion y anida auditoria; si fallara,
 *    la disputa tiene que quedar resuelta igual —la decision del operador no
 *    se pierde porque el efecto secundario no pudo escribirse—.
 */

/* -------------------------------------------------------------------------- */
/* Tipos publicos                                                              */
/* -------------------------------------------------------------------------- */

export interface PublicDispute {
  id: string;
  orderId: string;
  orderNumber: string;
  status: disputeRepo.DisputeStatus;
  reason: disputeRepo.DisputeReason;
  resolution: disputeRepo.DisputeResolution | null;
  currency: string;
  /** Centavos como string, como todo el dinero que sale de un Service. */
  refundedAmount: string | null;
  orderTotalAmount: string;
  openedAt: string;
  sellerResponseDueAt: string | null;
  sellerRespondedAt: string | null;
  resolvedAt: string | null;
  abierta: boolean;
}

export interface DisputeDetail extends PublicDispute {
  /** Como ve esta disputa quien la pidio. La pantalla decide que botones muestra. */
  viewer: DisputeViewer;
  timeline: DisputeTimelineEntry[];
  evidencias: {
    id: string;
    /** `null` cuando la fila vino de un import viejo: el ERD lo admite. */
    type: string | null;
    url: string | null;
    note: string | null;
    uploadedBy: disputeRepo.EvidenceUploader;
    createdAt: string;
  }[];
  acciones: {
    action: disputeRepo.DisputeResolution;
    amount: string | null;
    note: string | null;
    decidedAt: string;
  }[];
}

function toPublicDispute(fila: disputeRepo.DisputeWithOrder): PublicDispute {
  return {
    id: fila.id,
    orderId: fila.orderId,
    orderNumber: fila.orderNumber,
    status: fila.status,
    reason: fila.reason,
    resolution: fila.resolution,
    currency: fila.currency,
    refundedAmount: fila.refundedAmount?.toString() ?? null,
    orderTotalAmount: fila.orderTotalAmount.toString(),
    openedAt: (fila.openedAt ?? fila.createdAt).toISOString(),
    sellerResponseDueAt: fila.sellerResponseDueAt?.toISOString() ?? null,
    sellerRespondedAt: fila.sellerRespondedAt?.toISOString() ?? null,
    resolvedAt: fila.resolvedAt?.toISOString() ?? null,
    abierta: isOpen(fila.status),
  };
}

/* -------------------------------------------------------------------------- */
/* Apertura (TS-050/051, BR-032, DEC-034)                                      */
/* -------------------------------------------------------------------------- */

export interface OpenDisputeInput {
  orderId: string;
  reason: string;
  description: string;
  evidencias?: readonly unknown[] | undefined;
}

/**
 * El comprador abre un reclamo.
 *
 * ⚠️ LA VENTANA NO ES UNA SOLA. `claimEligibility` distingue tres caminos:
 * enviada/entregada/completada dentro de `dispute_window_days`, y ademas
 * `PROCESSING` con el plazo de despacho vencido, que BR-032 habilita solo
 * para "no lo recibí" —reclamar que el producto no es lo que se publicó
 * cuando todavia no se despacho no tiene sentido—.
 *
 * ⚠️ SE PUEDE RECLAMAR SOBRE UNA ORDEN `COMPLETED`. DEC-034 lo contempla: el
 * cierre automatico por vencimiento de la proteccion no puede ser la forma de
 * quedarse sin reclamo, porque ocurre solo.
 */
export async function openDispute(
  user: PublicUser,
  input: OpenDisputeInput,
): Promise<PublicDispute> {
  // ⚠️ SE COPIA A UN `const` DESPUES DE ESTRECHAR: TypeScript descarta el
  // estrechamiento de una propiedad cuando se la usa dentro de un callback
  // —el de la transaccion—, porque no puede probar que nadie la reasigno.
  const reason = input.reason;
  if (!isDisputeReason(reason)) throw errors.disputeInvalid('Elegí un motivo válido');

  const descripcion = normalizeDescription(input.description);
  if (!descripcion.ok) throw errors.disputeInvalid(descripcion.motivo);

  const evidencias = normalizeEvidences(input.evidencias);
  if (!evidencias.ok) throw errors.disputeInvalid(evidencias.motivo);

  const orden = await disputeRepo.findOrderForClaim(input.orderId);
  if (orden === undefined) throw errors.orderNotFound();

  // Solo el comprador. Un `404` en vez de un `403` no aplica acá: la orden es
  // suya o no existe para esta persona, y el error ya es generico.
  if (orden.buyerId !== user.id) throw errors.orderNotFound();

  if (await disputeRepo.hasOpenDispute(input.orderId)) throw errors.disputeAlreadyExists();

  const ahora = new Date();
  const elegible = claimEligibility(orden, reason, await getClaimWindowSettings(), ahora);

  if (!elegible.ok) {
    if (elegible.motivo === 'ventana_vencida') throw errors.disputeWindowClosed();

    throw errors.disputeNotAllowed(motivoDeRechazo(elegible.motivo));
  }

  const vence = sellerResponseDueFor(ahora, await getSellerResponseDays());

  const fila = await getDatabase().transaction(async (tx) => {
    const abierta = await disputeRepo.insertOpen(
      {
        orderId: orden.id,
        buyerId: user.id,
        sellerId: orden.sellerId,
        reason,
        currency: orden.currency,
        openedAt: ahora,
      },
      tx,
    );

    // OPEN -> WAITING_SELLER en el mismo acto: el estado `OPEN` existe en el
    // ERD, pero un reclamo que no le corre el reloj a nadie no sirve de nada.
    const enEspera = await disputeRepo.transitionStatus(
      abierta.id,
      'OPEN',
      'WAITING_SELLER',
      { sellerResponseDueAt: vence },
      tx,
    );

    await disputeRepo.insertEvidences(
      [
        {
          disputeId: abierta.id,
          uploadedBy: 'buyer',
          uploaderId: user.id,
          type: 'description',
          url: null,
          note: descripcion.text,
        },
        ...evidencias.evidences.map((evidencia) => ({
          disputeId: abierta.id,
          uploadedBy: 'buyer' as const,
          uploaderId: user.id,
          type: evidencia.type,
          url: evidencia.url,
          note: evidencia.note,
        })),
      ],
      tx,
    );

    await emitHistoryEvent(
      {
        userId: user.id,
        eventType: 'DISPUTE_OPENED',
        role: 'buyer',
        refEntityType: 'dispute',
        refEntityId: abierta.id,
        data: { orderId: orden.id, reason: input.reason },
      },
      tx,
    );

    await audit.record(
      {
        actorType: 'user',
        actorId: user.id,
        action: 'DISPUTE_OPENED',
        entityType: 'dispute',
        entityId: abierta.id,
        after: { status: 'WAITING_SELLER', reason },
        metadata: {
          orderId: orden.id,
          orderNumber: orden.orderNumber,
          sellerId: orden.sellerId,
          base: elegible.base,
        },
      },
      tx,
    );

    return enEspera ?? abierta;
  });

  return toPublicDispute({
    ...fila,
    orderNumber: orden.orderNumber,
    orderTotalAmount: orden.totalAmount,
  });
}

/** Texto para cada motivo de rechazo de `claimEligibility`. */
function motivoDeRechazo(motivo: string): string {
  switch (motivo) {
    case 'estado':
      return 'Todavía no se puede reclamar sobre esta compra';
    case 'despacho_en_plazo':
      return 'El vendedor todavía está dentro del plazo para despachar';
    case 'motivo_no_admitido':
      return 'Mientras el pedido no se despachó, sólo se puede reclamar que no llegó';
    case 'sin_fecha':
      return 'Esta compra todavía no tiene fecha de envío';
    default:
      return 'No se puede abrir un reclamo sobre esta compra';
  }
}

/* -------------------------------------------------------------------------- */
/* Respuesta del vendedor (TS-052)                                             */
/* -------------------------------------------------------------------------- */

export async function respondAsSeller(
  user: PublicUser,
  disputeId: string,
  texto: string,
  evidenciasCrudas?: readonly unknown[],
): Promise<PublicDispute> {
  const respuesta = normalizeDescription(texto);
  if (!respuesta.ok) throw errors.disputeInvalid(respuesta.motivo);

  const evidencias = normalizeEvidences(evidenciasCrudas);
  if (!evidencias.ok) throw errors.disputeInvalid(evidencias.motivo);

  const fila = await disputeRepo.findByIdWithOrder(disputeId);
  if (fila === undefined) throw errors.disputeNotFound();

  // Un reclamo de otro vendedor no da "no es tuyo": da lo mismo que uno que no
  // existe.
  const perfil = await sellerRepo.findByUserId(user.id);
  if (fila.sellerId !== perfil?.id) throw errors.disputeNotFound();

  if (!canTransition(fila.status, 'UNDER_REVIEW') || fila.status !== 'WAITING_SELLER') {
    throw errors.disputeInvalidTransition('Este reclamo ya no está esperando tu respuesta');
  }

  const ahora = new Date();

  const actualizada = await getDatabase().transaction(async (tx) => {
    const enRevision = await disputeRepo.transitionStatus(
      disputeId,
      'WAITING_SELLER',
      'UNDER_REVIEW',
      { sellerRespondedAt: ahora },
      tx,
    );

    // Otro proceso ya la movio: no se pisa.
    if (enRevision === undefined) {
      throw errors.disputeInvalidTransition('Este reclamo ya no está esperando tu respuesta');
    }

    await disputeRepo.insertEvidences(
      [
        {
          disputeId,
          uploadedBy: 'seller',
          uploaderId: user.id,
          type: 'response',
          url: null,
          note: respuesta.text,
        },
        ...evidencias.evidences.map((evidencia) => ({
          disputeId,
          uploadedBy: 'seller' as const,
          uploaderId: user.id,
          type: evidencia.type,
          url: evidencia.url,
          note: evidencia.note,
        })),
      ],
      tx,
    );

    await audit.record(
      {
        actorType: 'seller',
        actorId: user.id,
        action: 'DISPUTE_SELLER_RESPONDED',
        entityType: 'dispute',
        entityId: disputeId,
        before: { status: 'WAITING_SELLER' },
        after: { status: 'UNDER_REVIEW' },
        metadata: { orderId: fila.orderId, sellerId: fila.sellerId },
      },
      tx,
    );

    return enRevision;
  });

  return toPublicDispute({ ...actualizada, ...datosDeOrden(fila) });
}

/* -------------------------------------------------------------------------- */
/* Resolucion (TS-054)                                                         */
/* -------------------------------------------------------------------------- */

export interface ResolveInput {
  resolution: string;
  /** Centavos. Solo para reembolso parcial (o parcial junto a una sancion). */
  refundAmount?: bigint | undefined;
  note: string;
}

export interface ResolveResult {
  dispute: PublicDispute;
  /** `null` si la resolucion no llevaba reembolso. */
  refund: { ok: boolean; detalle: string } | null;
  sancionAplicada: boolean;
}

/**
 * Admin resuelve el reclamo.
 *
 * ⚠️ EL ORDEN IMPORTA Y ES: decidir → escribir la resolucion (transaccion) →
 * ejecutar el reembolso → aplicar la sancion. Las dos ultimas salen de la
 * transaccion a proposito: llaman a Mercado Pago y a otro modulo con su
 * propia transaccion, y una llamada de red adentro de una transaccion abierta
 * mantiene locks tomados por el tiempo que tarde un tercero.
 */
export async function resolve(
  adminUser: PublicUser,
  disputeId: string,
  input: ResolveInput,
): Promise<ResolveResult> {
  // Mismo motivo que en `openDispute`: el valor estrechado se copia a un
  // `const` para que sobreviva al callback de la transaccion.
  const resolution = input.resolution;
  if (!isDisputeResolution(resolution)) {
    throw errors.disputeInvalid('Elegí una resolución válida');
  }

  const nota = input.note.trim();
  if (nota.length === 0) throw errors.disputeInvalid('La resolución necesita una nota');

  const fila = await disputeRepo.findByIdWithOrder(disputeId);
  if (fila === undefined) throw errors.disputeNotFound();

  const sellerUserId = await disputeRepo.findSellerUserId(fila.sellerId);
  const permiso = canResolve(adminUser, fila, sellerUserId);

  // Sin capacidad, el reclamo no existe: el back-office no debería existir
  // para quien no es admin (misma regla que las pantallas).
  if (permiso === 'sin_capacidad') throw errors.disputeNotFound();
  if (permiso === 'es_parte') throw errors.disputeConflictOfInterest();

  if (fila.status === 'RESOLVED') {
    throw errors.disputeInvalidTransition('Este reclamo ya está resuelto');
  }

  const plan = planResolution(resolution, input.refundAmount, fila.orderTotalAmount);
  if (!plan.ok) throw errors.disputeInvalid(plan.motivo);

  const ahora = new Date();
  const estadoPrevio = fila.status;

  const resuelta = await getDatabase().transaction(async (tx) => {
    const actualizada = await disputeRepo.transitionStatus(
      disputeId,
      estadoPrevio,
      'RESOLVED',
      { resolvedAt: ahora, resolution },
      tx,
    );

    if (actualizada === undefined) {
      throw errors.disputeInvalidTransition('Otra persona ya resolvió este reclamo');
    }

    await disputeRepo.insertActions(
      plan.plan.acciones.map((accion) => ({
        disputeId,
        action: accion.action,
        amount: accion.amount,
        currency: fila.currency,
        decidedBy: adminUser.id,
        note: nota,
      })),
      tx,
    );

    await emitHistoryEvent(
      {
        userId: fila.buyerId,
        eventType: 'DISPUTE_RESOLVED',
        role: 'buyer',
        refEntityType: 'dispute',
        refEntityId: disputeId,
        data: { resolution, orderId: fila.orderId },
      },
      tx,
    );

    if (sellerUserId !== undefined) {
      await emitHistoryEvent(
        {
          userId: sellerUserId,
          eventType: 'DISPUTE_RESOLVED',
          role: 'seller',
          refEntityType: 'dispute',
          refEntityId: disputeId,
          data: { resolution, orderId: fila.orderId },
        },
        tx,
      );
    }

    await audit.record(
      {
        actorType: 'admin',
        actorId: adminUser.id,
        action: 'DISPUTE_RESOLVED',
        entityType: 'dispute',
        entityId: disputeId,
        before: { status: estadoPrevio },
        after: { status: 'RESOLVED', resolution },
        metadata: {
          orderId: fila.orderId,
          orderNumber: fila.orderNumber,
          sellerId: fila.sellerId,
          nota,
          reembolso: plan.plan.reembolso === null ? null : plan.plan.reembolso.total,
        },
      },
      tx,
    );

    return actualizada;
  });

  const refund = await ejecutarReembolso(adminUser, fila, plan.plan.reembolso, nota);
  const sancionAplicada = await aplicarSancionDeResolucion(
    adminUser,
    fila,
    plan.plan.sancion,
    nota,
    disputeId,
  );

  return {
    dispute: toPublicDispute({ ...resuelta, ...datosDeOrden(fila) }),
    refund,
    sancionAplicada,
  };
}

/**
 * Ejecuta el reembolso contra el pago de la orden.
 *
 * ⚠️ NO LANZA. Un rechazo de Mercado Pago no puede tumbar una resolucion ya
 * escrita: se registra y se devuelve para que la pantalla lo muestre. El
 * detalle crudo del rechazo ya queda en `refunds` (DEC-035) y en `audit_log`.
 */
async function ejecutarReembolso(
  adminUser: PublicUser,
  fila: disputeRepo.DisputeWithOrder,
  reembolso: { amountCents: bigint | null; total: boolean } | null,
  nota: string,
): Promise<{ ok: boolean; detalle: string } | null> {
  if (reembolso === null) return null;

  const pagos = await paymentRepo.findByOrderId(fila.orderId);
  const pago = pagos.find((p) => p.mpPaymentId !== null);

  if (pago === undefined) {
    await registrarFalloDeReembolso(adminUser, fila, 'la orden no tiene un pago reembolsable');

    return { ok: false, detalle: 'La orden no tiene un pago que se pueda reembolsar' };
  }

  try {
    const hecho = await refundPayment(adminUser, {
      paymentId: pago.id,
      amountCents: reembolso.amountCents,
      reason: `Reclamo ${fila.orderNumber}: ${nota}`,
    });

    await disputeRepo.updateRefundedAmount(fila.id, BigInt(hecho.amount));

    return { ok: true, detalle: `Reembolso ${hecho.status}` };
  } catch (error) {
    const detalle = error instanceof Error ? error.message : String(error);
    await registrarFalloDeReembolso(adminUser, fila, detalle);

    return { ok: false, detalle };
  }
}

async function registrarFalloDeReembolso(
  adminUser: PublicUser,
  fila: disputeRepo.DisputeWithOrder,
  detalle: string,
): Promise<void> {
  await audit.record({
    actorType: 'admin',
    actorId: adminUser.id,
    action: 'DISPUTE_REFUND_FAILED',
    entityType: 'dispute',
    entityId: fila.id,
    metadata: { orderId: fila.orderId, orderNumber: fila.orderNumber, detalle },
  });
}

/**
 * Aplica la sancion que la resolucion produce, si alguna.
 *
 * ⚠️ TAMPOCO LANZA, y por el mismo motivo: la decision ya esta escrita. Un
 * fallo queda en el log y el operador puede aplicarla a mano desde
 * `/admin/vendedores`.
 */
async function aplicarSancionDeResolucion(
  adminUser: PublicUser,
  fila: disputeRepo.DisputeWithOrder,
  sancion: 'penalty' | 'suspension' | null,
  nota: string,
  disputeId: string,
): Promise<boolean> {
  if (sancion === null) return false;

  try {
    await applySanction(adminUser, fila.sellerId, sancion, nota, { disputeId });

    return true;
  } catch (error) {
    console.error(
      `[disputes] no se pudo aplicar la sancion ${sancion} del reclamo ${disputeId}:`,
      error instanceof Error ? error.message : String(error),
    );

    return false;
  }
}

/* -------------------------------------------------------------------------- */
/* Escalada automatica (TS-053)                                                */
/* -------------------------------------------------------------------------- */

export interface EscalationSummary {
  revisados: number;
  escalados: number;
}

/**
 * Los reclamos cuyo plazo de respuesta vencio pasan a revision de Offside.
 *
 * ⚠️ EL SILENCIO DEL VENDEDOR NO RESUELVE EL RECLAMO A FAVOR DE NADIE: lo
 * pone en manos de una persona. Resolver automaticamente contra quien no
 * contesto seria una politica de negocio que la documentacion no tomo.
 *
 * Idempotente: la condicion de origen va en el WHERE del UPDATE.
 */
export async function escalateExpired(
  now: Date = new Date(),
  limite = 100,
): Promise<EscalationSummary> {
  const vencidos = await disputeRepo.findExpiredWaitingSeller(now, limite);
  let escalados = 0;

  for (const disputa of vencidos) {
    const movida = await disputeRepo.transitionStatus(
      disputa.id,
      'WAITING_SELLER',
      'UNDER_REVIEW',
      {},
    );

    if (movida === undefined) continue;
    escalados += 1;

    await audit.record({
      actorType: 'system',
      action: 'DISPUTE_ESCALATED',
      entityType: 'dispute',
      entityId: disputa.id,
      before: { status: 'WAITING_SELLER' },
      after: { status: 'UNDER_REVIEW' },
      metadata: {
        orderId: disputa.orderId,
        sellerId: disputa.sellerId,
        venciaEl: disputa.sellerResponseDueAt?.toISOString() ?? null,
      },
    });
  }

  return { revisados: vencidos.length, escalados };
}

/* -------------------------------------------------------------------------- */
/* Lecturas                                                                    */
/* -------------------------------------------------------------------------- */

/** Un reclamo con todo lo que la pantalla necesita, autorizado por rol. */
export async function getDispute(user: PublicUser, disputeId: string): Promise<DisputeDetail> {
  const fila = await disputeRepo.findByIdWithOrder(disputeId);
  if (fila === undefined) throw errors.disputeNotFound();

  const perfil = await sellerRepo.findByUserId(user.id);
  const rol = viewerRole(user, fila, perfil?.id ?? null);

  // Quien no es parte ni tiene la capacidad no recibe un 403: para esa persona
  // el reclamo no existe.
  if (rol === null) throw errors.disputeNotFound();

  const [evidencias, acciones] = await Promise.all([
    disputeRepo.findEvidences(disputeId),
    disputeRepo.findActions(disputeId),
  ]);

  return {
    ...toPublicDispute(fila),
    viewer: rol,
    timeline: buildTimeline(fila, evidencias, acciones),
    evidencias: evidencias.map((evidencia) => ({
      id: evidencia.id,
      type: evidencia.type,
      url: evidencia.url,
      note: evidencia.note,
      uploadedBy: evidencia.uploadedBy,
      createdAt: evidencia.createdAt.toISOString(),
    })),
    acciones: acciones.map((accion) => ({
      action: accion.action,
      amount: accion.amount?.toString() ?? null,
      note: accion.note,
      decidedAt: accion.createdAt.toISOString(),
    })),
  };
}

/** Reclamos que abrio esta persona. */
export async function listMyDisputes(user: PublicUser): Promise<PublicDispute[]> {
  const filas = await disputeRepo.findByBuyerId(user.id);

  return filas.map(toPublicDispute);
}

/** Reclamos contra este vendedor. */
export async function listForSeller(user: PublicUser): Promise<PublicDispute[]> {
  const perfil = await sellerRepo.findByUserId(user.id);
  if (perfil?.id === undefined) return [];

  const filas = await disputeRepo.findBySellerId(perfil.id);

  return filas.map(toPublicDispute);
}

/** Cuantos reclamos abiertos tiene el vendedor. Para el panel. */
export async function countOpenForSeller(user: PublicUser): Promise<number> {
  const perfil = await sellerRepo.findByUserId(user.id);
  if (perfil?.id === undefined) return 0;

  return disputeRepo.countOpenBySellerId(perfil.id);
}

/** La bandeja del back-office. Exige la capacidad. */
export async function listOpenForAdmin(
  adminUser: PublicUser,
  filtros: Partial<disputeRepo.AdminDisputeFilters> = {},
): Promise<PublicDispute[]> {
  if (canResolve(adminUser, { buyerId: '', sellerId: '' }, undefined) === 'sin_capacidad') {
    throw errors.disputeNotFound();
  }

  const filas = await disputeRepo.findForAdmin({
    ...filtros,
    limit: filtros.limit ?? 50,
    offset: filtros.offset ?? 0,
  });

  return filas.map(toPublicDispute);
}

/**
 * El reclamo de una orden, si esta persona puede verlo.
 *
 * Lo usan el detalle de la compra y el de la venta para mostrar el estado del
 * reclamo sin mandar a otra pantalla.
 */
export async function getDisputeForOrder(
  user: PublicUser,
  orderId: string,
): Promise<PublicDispute | null> {
  const fila = await disputeRepo.findByOrderIdWithOrder(orderId);
  if (fila === undefined) return null;

  const perfil = await sellerRepo.findByUserId(user.id);
  if (viewerRole(user, fila, perfil?.id ?? null) === null) return null;

  return toPublicDispute(fila);
}

/**
 * Si la orden tiene un reclamo abierto.
 *
 * ⚠️ LA CONSULTA `orders`: una orden con reclamo abierto NO se cierra sola al
 * vencer la ventana de proteccion (BR-033). Por eso vive acá y no allá: el
 * predicado de "reclamo abierto" es de este modulo.
 */
export async function hasOpenDispute(orderId: string, db?: Database): Promise<boolean> {
  return disputeRepo.hasOpenDispute(orderId, db);
}

/** Los campos de la orden que `DisputeWithOrder` agrega a la fila de disputa. */
function datosDeOrden(
  origen: Pick<disputeRepo.DisputeWithOrder, 'orderNumber' | 'orderTotalAmount'>,
): Pick<disputeRepo.DisputeWithOrder, 'orderNumber' | 'orderTotalAmount'> {
  return { orderNumber: origen.orderNumber, orderTotalAmount: origen.orderTotalAmount };
}

/*
 * ⚠️ SE RE-EXPORTAN DESDE EL SERVICE. Los `<select>` de motivo y de resolucion
 * necesitan la lista de valores del enum, y una pantalla no tiene por que
 * importar de un REPOSITORIO para conseguirla: la capa que la UI conoce es el
 * Service (CLAUDE.md §8). Duplicar la lista en la pantalla seria peor: el dia
 * que el enum crezca, el formulario no se entera.
 */
export {
  DISPUTE_REASONS,
  DISPUTE_RESOLUTIONS,
  DISPUTE_STATUSES,
  type DisputeReason,
  type DisputeResolution,
  type DisputeStatus,
} from '../repositories/dispute.repository';

export { resolutionLabel };
