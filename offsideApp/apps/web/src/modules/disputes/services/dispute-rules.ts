import { CAPABILITIES, hasCapability } from '@/lib/permissions';

import type { PublicUser } from '../../auth/services/auth.service';
import type { OrderRow } from '../../orders/services/order.service';
import { isDispatchOverdue } from '../../orders/services/order-transitions';
import type { SanctionType } from '../../trust/repositories/sanction.repository';
import {
  DISPUTE_REASONS,
  DISPUTE_RESOLUTIONS,
  type DisputeActionRow,
  type DisputeEvidenceRow,
  type DisputeReason,
  type DisputeResolution,
  type DisputeRow,
  type DisputeStatus,
} from '../repositories/dispute.repository';

/**
 * Reglas PURAS de los reclamos (DEC-009, `trust-and-safety.md` §5, BR-032/034).
 *
 * Sin base y sin reloj propio: todo lo que depende de "ahora" llega por
 * parametro, igual que en `order-transitions.ts`. El Service las aplica.
 */

/* -------------------------------------------------------------------------- */
/* Maquina de estados (DEC-009)                                                */
/* -------------------------------------------------------------------------- */

interface Transition {
  from: DisputeStatus;
  to: DisputeStatus;
}

/**
 * Flujo LINEAL, tal como DEC-009 lo dibuja: `OPEN → WAITING_SELLER →
 * UNDER_REVIEW → RESOLVED`. No hay atajos.
 *
 * ⚠️ ASUMIDO: un administrador NO resuelve mientras la disputa espera al
 * vendedor. "Cuando interviene administracion" es TS-052 🟡; saltar el turno
 * del vendedor seria decidirlo desde el codigo. Si el vendedor no responde,
 * el barrido la escala al vencer el plazo y recien ahi se puede resolver.
 */
const TRANSICIONES: readonly Transition[] = [
  { from: 'OPEN', to: 'WAITING_SELLER' },
  { from: 'WAITING_SELLER', to: 'UNDER_REVIEW' },
  { from: 'UNDER_REVIEW', to: 'RESOLVED' },
];

export function canTransition(from: DisputeStatus, to: DisputeStatus): boolean {
  return TRANSICIONES.some((t) => t.from === from && t.to === to);
}

/** Estados en los que el reclamo todavia no se cerro. */
export const ESTADOS_ABIERTOS: readonly DisputeStatus[] = [
  'OPEN',
  'WAITING_SELLER',
  'UNDER_REVIEW',
];

export function isOpen(status: DisputeStatus): boolean {
  return ESTADOS_ABIERTOS.includes(status);
}

export function isDisputeReason(value: unknown): value is DisputeReason {
  return typeof value === 'string' && (DISPUTE_REASONS as readonly string[]).includes(value);
}

export function isDisputeResolution(value: unknown): value is DisputeResolution {
  return typeof value === 'string' && (DISPUTE_RESOLUTIONS as readonly string[]).includes(value);
}

/* -------------------------------------------------------------------------- */
/* Ventana de reclamo (TS-050 / BR-034 / BR-032)                               */
/* -------------------------------------------------------------------------- */

const MS_POR_DIA = 24 * 60 * 60 * 1000;

export interface ClaimWindowSettings {
  /** `app_settings.dispute_window_days`. */
  windowDays: number;
  /** `app_settings.dispatch_deadline_hours` (BR-032). */
  dispatchDeadlineHours: number;
}

export type ClaimOrder = Pick<OrderRow, 'status' | 'paidAt' | 'shippedAt' | 'deliveredAt'>;

export type ClaimEligibility =
  | {
      ok: true;
      /** Desde donde se conto la ventana. */
      base: 'delivered' | 'shipped' | 'dispatch_overdue';
      /** Fin de la ventana; `null` cuando la habilita el despacho vencido. */
      deadline: Date | null;
    }
  | {
      ok: false;
      motivo:
        'estado' | 'ventana_vencida' | 'despacho_en_plazo' | 'motivo_no_admitido' | 'sin_fecha';
    };

/**
 * Fin de la ventana de reclamo de una orden despachada.
 *
 * Se cuenta desde la ENTREGA confirmada y, si el comprador nunca confirmo,
 * desde el DESPACHO: sin Correo Argentino nadie mas sabe cuando llego, y
 * contar desde el despacho es lo unico que no deja la ventana abierta para
 * siempre. Devuelve `null` si la orden no tiene ninguna de las dos fechas.
 */
export function claimDeadlineFor(order: ClaimOrder, windowDays: number): Date | null {
  assertDiasPositivos(windowDays);
  const base = order.deliveredAt ?? order.shippedAt;
  if (base === null) return null;

  return new Date(base.getTime() + windowDays * MS_POR_DIA);
}

/**
 * Si el comprador puede abrir un reclamo sobre la orden, ahora.
 *
 *  - `SHIPPED` / `DELIVERED` / `COMPLETED`: dentro de la ventana (TS-050).
 *    `COMPLETED` entra porque la orden se completa sola al vencer la
 *    proteccion (MF-040) y la ventana de reclamo es una clave distinta: si
 *    fuera mas larga, cerrar la orden no puede cerrar el reclamo.
 *  - `PROCESSING` con el plazo de despacho vencido: BR-032 "habilita reclamo
 *    producto no recibido", y SOLO ese motivo: antes del despacho no hay
 *    producto que este dañado ni sea distinto.
 *  - Cualquier otro estado: no.
 */
export function claimEligibility(
  order: ClaimOrder,
  reason: DisputeReason,
  settings: ClaimWindowSettings,
  now: Date,
): ClaimEligibility {
  switch (order.status) {
    case 'SHIPPED':
    case 'DELIVERED':
    case 'COMPLETED': {
      const deadline = claimDeadlineFor(order, settings.windowDays);
      if (deadline === null) return { ok: false, motivo: 'sin_fecha' };
      if (now.getTime() > deadline.getTime()) return { ok: false, motivo: 'ventana_vencida' };

      return { ok: true, base: order.deliveredAt !== null ? 'delivered' : 'shipped', deadline };
    }
    case 'PROCESSING': {
      if (reason !== 'not_received') return { ok: false, motivo: 'motivo_no_admitido' };
      if (!isDispatchOverdue(order, settings.dispatchDeadlineHours, now)) {
        return { ok: false, motivo: 'despacho_en_plazo' };
      }

      return { ok: true, base: 'dispatch_overdue', deadline: null };
    }
    case 'PENDING_PAYMENT':
    case 'PAID':
    case 'CANCELLED':
      return { ok: false, motivo: 'estado' };
  }
}

/** Plazo del vendedor para responder (TS-052 ⚙️ `dispute_seller_response_days`). */
export function sellerResponseDueFor(openedAt: Date, responseDays: number): Date {
  assertDiasPositivos(responseDays);
  return new Date(openedAt.getTime() + responseDays * MS_POR_DIA);
}

function assertDiasPositivos(valor: number): void {
  if (!Number.isFinite(valor) || valor <= 0) {
    throw new Error(`un plazo en dias debe ser un numero positivo (recibido: ${valor})`);
  }
}

/* -------------------------------------------------------------------------- */
/* Resoluciones (TS-054: efectos combinables)                                  */
/* -------------------------------------------------------------------------- */

export interface ResolutionPlan {
  /** Filas de `dispute_actions`, en orden. */
  acciones: { action: DisputeResolution; amount: bigint | null }[];
  /** `amountCents` null = reembolso TOTAL, como lo espera `refundPayment`. */
  reembolso: { amountCents: bigint | null; total: boolean } | null;
  /** Sancion que produce la resolucion, si alguna (ERD §16.2). */
  sancion: Extract<SanctionType, 'penalty' | 'suspension'> | null;
}

export type ResolutionPlanResult =
  { ok: true; plan: ResolutionPlan } | { ok: false; motivo: string };

/**
 * Traduce una resolucion a sus efectos.
 *
 *  - `no_action` / `return_required`: sin efecto automatico. ⚠️ OR-006: el
 *    orden de operaciones de una devolucion es ⚙️ con valor 🟡; no se inventa,
 *    asi que `return_required` solo deja constancia.
 *  - `full_refund`: reembolso total. No admite importe.
 *  - `partial_refund`: exige un importe entre 0 y el total, exclusivos.
 *  - `seller_penalty` / `seller_suspended`: sancion; y si viene un importe,
 *    ADEMAS un reembolso (TS-054), total o parcial segun el importe.
 */
export function planResolution(
  resolution: DisputeResolution,
  refundAmount: bigint | undefined,
  orderTotal: bigint,
): ResolutionPlanResult {
  if (refundAmount !== undefined && refundAmount <= 0n) {
    return { ok: false, motivo: 'El importe a reembolsar debe ser mayor a cero' };
  }
  if (refundAmount !== undefined && refundAmount > orderTotal) {
    return { ok: false, motivo: 'El importe a reembolsar supera el total de la orden' };
  }

  switch (resolution) {
    case 'no_action':
    case 'return_required':
      if (refundAmount !== undefined) {
        return { ok: false, motivo: 'Esta resolución no lleva importe de reembolso' };
      }
      return {
        ok: true,
        plan: { acciones: [{ action: resolution, amount: null }], reembolso: null, sancion: null },
      };

    case 'full_refund':
      if (refundAmount !== undefined && refundAmount !== orderTotal) {
        return {
          ok: false,
          motivo: 'Un reembolso total no lleva importe: se devuelve toda la orden',
        };
      }
      return {
        ok: true,
        plan: {
          acciones: [{ action: 'full_refund', amount: orderTotal }],
          reembolso: { amountCents: null, total: true },
          sancion: null,
        },
      };

    case 'partial_refund':
      if (refundAmount === undefined) {
        return { ok: false, motivo: 'Un reembolso parcial necesita el importe a devolver' };
      }
      if (refundAmount === orderTotal) {
        return { ok: false, motivo: 'Para devolver toda la orden usá el reembolso total' };
      }
      return {
        ok: true,
        plan: {
          acciones: [{ action: 'partial_refund', amount: refundAmount }],
          reembolso: { amountCents: refundAmount, total: false },
          sancion: null,
        },
      };

    case 'seller_penalty':
    case 'seller_suspended': {
      const sancion = resolution === 'seller_penalty' ? 'penalty' : 'suspension';
      const acciones: ResolutionPlan['acciones'] = [{ action: resolution, amount: null }];
      let reembolso: ResolutionPlan['reembolso'] = null;

      if (refundAmount !== undefined) {
        const total = refundAmount === orderTotal;
        acciones.push({ action: total ? 'full_refund' : 'partial_refund', amount: refundAmount });
        reembolso = { amountCents: total ? null : refundAmount, total };
      }

      return { ok: true, plan: { acciones, reembolso, sancion } };
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Quien puede ver / operar                                                    */
/* -------------------------------------------------------------------------- */

export type DisputeViewer = 'buyer' | 'seller' | 'admin';

/**
 * Rol del usuario frente a UNA disputa concreta, o `null` si no tiene nada
 * que ver con ella.
 *
 * Las partes van ANTES que la capacidad: un administrador que ademas es el
 * comprador la ve como comprador. Autorizar la resolucion es aparte
 * (`canResolve`), y ahi ser parte es justamente lo que lo excluye.
 */
export function viewerRole(
  user: Pick<PublicUser, 'id' | 'adminRole'>,
  dispute: Pick<DisputeRow, 'buyerId' | 'sellerId'>,
  ownSellerProfileId: string | null,
): DisputeViewer | null {
  if (dispute.buyerId === user.id) return 'buyer';
  if (ownSellerProfileId !== null && dispute.sellerId === ownSellerProfileId) return 'seller';
  if (hasCapability(user.adminRole, CAPABILITIES.DISPUTES_RESOLVE)) return 'admin';

  return null;
}

export type ResolveCheck = 'ok' | 'sin_capacidad' | 'es_parte';

/** Capacidad `disputes:resolve` Y no ser parte del reclamo. */
export function canResolve(
  user: Pick<PublicUser, 'id' | 'adminRole'>,
  dispute: Pick<DisputeRow, 'buyerId' | 'sellerId'>,
  sellerUserId: string | undefined,
): ResolveCheck {
  if (!hasCapability(user.adminRole, CAPABILITIES.DISPUTES_RESOLVE)) return 'sin_capacidad';
  if (dispute.buyerId === user.id || sellerUserId === user.id) return 'es_parte';

  return 'ok';
}

/* -------------------------------------------------------------------------- */
/* Evidencias (TS-060/061): SOLO texto o URL                                   */
/* -------------------------------------------------------------------------- */

/** Techos de cordura, no reglas de negocio. Ampliarlos es un cambio MENOR. */
export const EVIDENCE_MAX_ITEMS = 10;
export const EVIDENCE_MAX_LENGTH = 2_000;
export const DESCRIPTION_MIN_LENGTH = 10;
export const DESCRIPTION_MAX_LENGTH = 4_000;

export interface NormalizedEvidence {
  type: 'text' | 'url';
  url: string | null;
  note: string | null;
}

export type EvidenceResult =
  { ok: true; evidences: NormalizedEvidence[] } | { ok: false; motivo: string };

/**
 * Una evidencia es una URL si —y solo si— es `http(s)://` completa y sin
 * espacios. Cualquier otra cosa es texto, incluido un `javascript:` o un
 * `data:`: se guardan como nota y ninguna pantalla los enlaza.
 */
function esUrl(valor: string): boolean {
  if (/\s/.test(valor)) return false;
  try {
    const url = new URL(valor);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

export function normalizeEvidences(items: readonly unknown[] | undefined): EvidenceResult {
  if (items === undefined) return { ok: true, evidences: [] };
  if (items.length > EVIDENCE_MAX_ITEMS) {
    return { ok: false, motivo: `Se admiten hasta ${EVIDENCE_MAX_ITEMS} evidencias por envío` };
  }

  const evidences: NormalizedEvidence[] = [];
  for (const item of items) {
    if (typeof item !== 'string')
      return { ok: false, motivo: 'Cada evidencia tiene que ser texto' };
    const valor = item.trim();
    if (valor.length === 0) continue;
    if (valor.length > EVIDENCE_MAX_LENGTH) {
      return { ok: false, motivo: `Cada evidencia admite hasta ${EVIDENCE_MAX_LENGTH} caracteres` };
    }

    evidences.push(
      esUrl(valor)
        ? { type: 'url', url: valor, note: null }
        : { type: 'text', url: null, note: valor },
    );
  }

  return { ok: true, evidences };
}

export function normalizeDescription(
  value: unknown,
): { ok: true; text: string } | { ok: false; motivo: string } {
  if (typeof value !== 'string') return { ok: false, motivo: 'Contanos qué pasó' };
  const text = value.trim();
  if (text.length < DESCRIPTION_MIN_LENGTH) {
    return {
      ok: false,
      motivo: `Contanos qué pasó con al menos ${DESCRIPTION_MIN_LENGTH} caracteres`,
    };
  }
  if (text.length > DESCRIPTION_MAX_LENGTH) {
    return { ok: false, motivo: `El texto admite hasta ${DESCRIPTION_MAX_LENGTH} caracteres` };
  }

  return { ok: true, text };
}

/* -------------------------------------------------------------------------- */
/* Linea de tiempo (para las pantallas)                                        */
/* -------------------------------------------------------------------------- */

export type TimelineKind = 'apertura' | 'respuesta' | 'escalada' | 'resolucion' | 'reembolso';

export interface DisputeTimelineEntry {
  tipo: TimelineKind;
  /** ISO 8601. */
  at: string;
  actor: 'buyer' | 'seller' | 'system' | 'admin';
  /** Texto visible: con tildes. */
  titulo: string;
  detalle: string | null;
}

const NOMBRE_RESOLUCION: Record<DisputeResolution, string> = {
  no_action: 'Reclamo desestimado',
  partial_refund: 'Reembolso parcial',
  full_refund: 'Reembolso total',
  return_required: 'Devolución del producto requerida',
  seller_penalty: 'Penalización al vendedor',
  seller_suspended: 'Vendedor suspendido',
};

export function resolutionLabel(resolution: DisputeResolution): string {
  return NOMBRE_RESOLUCION[resolution];
}

const CON_REEMBOLSO: readonly DisputeResolution[] = ['full_refund', 'partial_refund'];

/**
 * Reconstruye la historia del reclamo SIN columnas nuevas.
 *
 * La escalada por vencimiento no tiene fecha propia en el ERD: se deduce de
 * que la disputa paso a revision sin respuesta del vendedor, y se fecha en el
 * vencimiento del plazo, que es el hecho que la produjo. El resultado del
 * reembolso se lee de `refunded_amount`: null = no se ejecuto todavia, 0 =
 * Mercado Pago lo rechazo, mayor a 0 = devuelto.
 */
export function buildTimeline(
  dispute: DisputeRow,
  evidencias: readonly DisputeEvidenceRow[],
  acciones: readonly DisputeActionRow[],
): DisputeTimelineEntry[] {
  const entradas: DisputeTimelineEntry[] = [];
  const nota = (type: string): string | null =>
    evidencias.find((e) => e.type === type)?.note ?? null;

  entradas.push({
    tipo: 'apertura',
    at: (dispute.openedAt ?? dispute.createdAt).toISOString(),
    actor: 'buyer',
    titulo: 'Reclamo abierto',
    detalle: nota('description'),
  });

  if (dispute.sellerRespondedAt !== null) {
    entradas.push({
      tipo: 'respuesta',
      at: dispute.sellerRespondedAt.toISOString(),
      actor: 'seller',
      titulo: 'El vendedor respondió',
      detalle: nota('response'),
    });
  } else if (
    (dispute.status === 'UNDER_REVIEW' || dispute.status === 'RESOLVED') &&
    dispute.sellerResponseDueAt !== null
  ) {
    entradas.push({
      tipo: 'escalada',
      at: dispute.sellerResponseDueAt.toISOString(),
      actor: 'system',
      titulo: 'Pasó a revisión sin respuesta del vendedor',
      detalle: 'Venció el plazo para responder',
    });
  }

  if (dispute.resolvedAt !== null && dispute.resolution !== null) {
    const notas = acciones.map((a) => a.note).filter((n): n is string => n !== null && n !== '');
    entradas.push({
      tipo: 'resolucion',
      at: dispute.resolvedAt.toISOString(),
      actor: 'admin',
      titulo: NOMBRE_RESOLUCION[dispute.resolution],
      detalle: notas.length > 0 ? notas[0]! : null,
    });

    const implicaReembolso =
      CON_REEMBOLSO.includes(dispute.resolution) ||
      acciones.some((a) => CON_REEMBOLSO.includes(a.action));

    if (implicaReembolso) {
      const devuelto = dispute.refundedAmount;
      entradas.push({
        tipo: 'reembolso',
        at: dispute.resolvedAt.toISOString(),
        actor: 'system',
        titulo:
          devuelto === null
            ? 'Reembolso pendiente de confirmación'
            : devuelto === 0n
              ? 'Mercado Pago rechazó el reembolso'
              : 'Reembolso realizado',
        detalle: devuelto === null || devuelto === 0n ? null : devuelto.toString(),
      });
    }
  }

  return entradas.sort((a, b) => a.at.localeCompare(b.at));
}
