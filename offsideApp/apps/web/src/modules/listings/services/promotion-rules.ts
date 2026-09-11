import { BASIS_POINTS_TOTAL } from '../../config/services/settings.service';

/**
 * Reglas PURAS de las publicaciones promocionadas (PS-021 "destacadas",
 * business-model.md §5.3). Sin IO: lo que se puede probar sin base.
 *
 * ⚠️ business-model.md §5.3 lista las publicaciones destacadas como fuente de
 * ingreso "futura, NO en MVP". El owner autorizo implementarlas el 2026-09-10
 * junto con el delta de esquema (`docs-implementation/erd-delta-2026-09-10.md`
 * §1 y §9); no lo decidio el codigo. La FORMA del cobro es "comision mayor
 * sobre la venta", no un pago anticipado.
 */

/** Lo minimo que hace falta de una publicacion para saber si esta promocionada. */
export interface PromotableListing {
  promotedUntil: Date | null;
}

/**
 * Una publicacion esta promocionada MIENTRAS `now() < promoted_until`.
 *
 * Es un PREDICADO DERIVADO, igual que el vendedor desconectado (SS-013) o de
 * vacaciones: no hay estado que apagar cuando vence. `promoted_until` queda
 * como evidencia de que estuvo promocionada.
 */
export function isPromoted(listing: PromotableListing, at: Date = new Date()): boolean {
  return listing.promotedUntil !== null && listing.promotedUntil.getTime() > at.getTime();
}

/**
 * Comision efectiva de una venta promocionada, en basis points.
 *
 * `base` es la tasa que le corresponderia al vendedor sin promocion —la de su
 * tier o la global— y `multiplier` el `promotion_commission_multiplier` del
 * Config Store (o el snapshot de la promocion, que es lo que manda en una
 * orden: DEC-030).
 *
 * ⚠️ SE REDONDEA A ENTERO Y SE TOPEA EN 10000. La tasa viaja en basis points
 * enteros para que `total * bp / 10000` no pase por punto flotante; un
 * multiplicador de 1.5 sobre 601 bp daria 901.5 y hay que decidir el centavo
 * aca, una sola vez. El tope existe porque una comision mayor al 100% haria
 * `marketplace_fee > transaction_amount`, que Mercado Pago rechaza.
 */
export function effectiveCommissionBasisPoints(base: number, multiplier: number): number {
  if (!Number.isInteger(base) || base < 0 || base > BASIS_POINTS_TOTAL) {
    throw new RangeError(`tasa base invalida: ${String(base)} bp`);
  }

  if (!Number.isFinite(multiplier) || multiplier <= 0) {
    throw new RangeError(`multiplicador invalido: ${String(multiplier)}`);
  }

  return Math.min(BASIS_POINTS_TOTAL, Math.round(base * multiplier));
}

/** Milisegundos de un dia, para no escribir `86400000` en dos lugares. */
const MS_POR_DIA = 24 * 60 * 60 * 1000;

/**
 * Cuando termina una promocion que empieza en `startsAt` y dura `days` dias.
 *
 * Dias CORRIDOS: el sistema no tiene calendario de feriados y una promocion
 * "de siete dias habiles" seria prometer una cuenta que nadie hace.
 */
export function promotionEndsAt(startsAt: Date, days: number): Date {
  if (!Number.isInteger(days) || days < 1) {
    throw new RangeError(`duracion invalida: ${String(days)} dias`);
  }

  return new Date(startsAt.getTime() + days * MS_POR_DIA);
}

/**
 * El multiplicador como lo espera `numeric(6,3)`: `3` -> `'3.000'`,
 * `1.5` -> `'1.500'`.
 *
 * `listing_promotions.commission_multiplier_snapshot` y
 * `orders.promotion_multiplier_at_transaction` usan la MISMA escala para que
 * copiar de una a otra no redondee. Se construye con `toFixed(3)`, que sobre
 * un numero ya acotado a tres decimales no introduce error.
 */
export function multiplierToSnapshot(multiplier: number): string {
  if (!Number.isFinite(multiplier) || multiplier <= 0) {
    throw new RangeError(`multiplicador invalido: ${String(multiplier)}`);
  }

  return multiplier.toFixed(3);
}

/** La inversa: lo que devuelve PostgreSQL para un `numeric` es un string. */
export function snapshotToMultiplier(snapshot: string): number {
  const valor = Number(snapshot);

  if (!Number.isFinite(valor) || valor <= 0) {
    throw new RangeError(`snapshot de multiplicador invalido: ${snapshot}`);
  }

  return valor;
}

/**
 * Importe de comision sobre un monto, en centavos.
 *
 * ⚠️ MISMA CUENTA QUE `calculateCommission()` EN `orders`: `bigint`, division
 * entera (trunca), cero para montos no positivos. La cotizacion que ve el
 * vendedor ANTES de promocionar tiene que dar el mismo centavo que la orden
 * va a congelar despues; si redondearan distinto, la pantalla prometeria un
 * numero y la venta cobraria otro.
 */
export function commissionAmountFor(amount: bigint, basisPoints: number): bigint {
  if (!Number.isInteger(basisPoints) || basisPoints < 0 || basisPoints > BASIS_POINTS_TOTAL) {
    throw new RangeError(`tasa invalida: ${String(basisPoints)} bp`);
  }

  if (amount <= 0n) return 0n;

  return (amount * BigInt(basisPoints)) / BigInt(BASIS_POINTS_TOTAL);
}
