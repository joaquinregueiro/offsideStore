import type { PaymentStatus } from '../../repositories/payment.repository';

/**
 * Mapeo del estado CRUDO de Mercado Pago al estado NORMALIZADO de Offside
 * (DEC-035, mercadopago-payments-spec.md §10).
 *
 * ✅ 🔴 LISTA VERIFICADA contra la documentacion oficial (2026-08-25,
 * "Consulta sobre el estado de un pago"): `approved`, `authorized`,
 * `in_process`, `pending`, `cancelled`, `refunded`, `charged_back`,
 * `in_mediation` y `rejected`. Son exactamente nueve y estan todos contemplados
 * abajo. Sigue aislado en un solo archivo por si MP agrega alguno.
 *
 * ⚠️ NO SE INVENTAN ESTADOS DE NEGOCIO. El conjunto de destino es exactamente
 * el enum `payment_status` que ya decidio DEC-028/DEC-035.
 *
 * REGLA DE SEGURIDAD: un estado desconocido —o uno que Offside no modela—
 * devuelve `null`, y quien llama **deja el estado local como esta** y conserva
 * el crudo. Adivinar una transicion sobre dinero es peor que no transicionar.
 */

/** Estados de Mercado Pago que Offside sabe interpretar. */
const MAPA: Record<string, PaymentStatus> = {
  pending: 'PENDING',
  in_process: 'IN_PROCESS',
  // Autorizado pero sin capturar: el dinero todavia no se movio.
  authorized: 'IN_PROCESS',
  approved: 'APPROVED',
  rejected: 'REJECTED',
  cancelled: 'CANCELLED',
  refunded: 'REFUNDED',
  charged_back: 'CHARGED_BACK',
};

/**
 * Estados de Mercado Pago que Offside conoce pero **deliberadamente no mapea**.
 *
 * `in_mediation` es una disputa abierta en MP. El enum de Offside no tiene un
 * estado para eso y las disputas son un ciclo de vida SEPARADO (DEC-034):
 * forzarlo a `IN_PROCESS` mentiria sobre el pago, y a `CHARGED_BACK` daria por
 * perdida una mediacion que todavia no termino. Se deja el estado local intacto
 * y el crudo persistido.
 */
const CONOCIDOS_SIN_MAPEO = new Set(['in_mediation']);

export interface MappedStatus {
  /** `null` = no corresponde cambiar el estado local. */
  status: PaymentStatus | null;
  /** `true` si el estado crudo no figura en ninguna de las dos listas. */
  unknown: boolean;
}

/**
 * `status_detail` que cambia el significado del estado.
 *
 * 🔴 Mercado Pago documenta `partially_refunded` como detalle de un pago que
 * sigue en `approved`: no hay un `status` propio para el reembolso parcial. Sin
 * esto, un webhook posterior a una devolucion parcial pisaria el
 * `PARTIALLY_REFUNDED` local y lo dejaria en `APPROVED`.
 */
const DETALLE_PARCIALMENTE_REEMBOLSADO = 'partially_refunded';

export function mapMercadoPagoStatus(
  mpStatus: string | null | undefined,
  mpStatusDetail?: string | null,
): MappedStatus {
  if (mpStatus === null || mpStatus === undefined || mpStatus === '') {
    return { status: null, unknown: true };
  }

  const normalizado = mpStatus.toLowerCase();
  const mapeado = MAPA[normalizado];

  if (
    mapeado === 'APPROVED' &&
    mpStatusDetail?.toLowerCase() === DETALLE_PARCIALMENTE_REEMBOLSADO
  ) {
    return { status: 'PARTIALLY_REFUNDED', unknown: false };
  }

  if (mapeado !== undefined) return { status: mapeado, unknown: false };
  if (CONOCIDOS_SIN_MAPEO.has(normalizado)) return { status: null, unknown: false };

  return { status: null, unknown: true };
}

/** Estados a partir de los cuales el pago ya no puede cambiar por si solo. */
const TERMINALES = new Set<PaymentStatus>(['REJECTED', 'CANCELLED', 'CHARGED_BACK']);

export function isTerminal(status: PaymentStatus): boolean {
  return TERMINALES.has(status);
}
