import { describe, expect, it } from 'vitest';

import { calculateCommission } from './order.service';
import { basisPointsToRateSnapshot } from '../../config/services/settings.service';

/**
 * Comision de Offside — 6% (DEC-043, cierra DEC-007).
 *
 * Es el numero mas caro del sistema: si esta mal, todas las ventas cobran mal.
 */

/** La tasa por defecto del Config Store: 600 bp = 6%. */
const BP = 600;

describe('calculateCommission', () => {
  it('es el 6% del total', () => {
    // $100.000 -> $6.000, el ejemplo de DEC-043.
    expect(calculateCommission(10_000_000n, BP)).toBe(600_000n);
  });

  it('trabaja en centavos, sin float', () => {
    expect(calculateCommission(100n, BP)).toBe(6n);
    expect(calculateCommission(1n, BP)).toBe(0n);
  });

  it('redondea hacia abajo: el centavo en disputa queda del lado del vendedor', () => {
    // 1999 * 0,06 = 119,94 -> 119
    expect(calculateCommission(1_999n, BP)).toBe(119n);
  });

  it('nunca supera el total, que es lo que Mercado Pago rechaza', () => {
    for (const total of [1n, 7n, 99n, 1_234n, 999_999_999n]) {
      expect(calculateCommission(total, BP)).toBeLessThan(total);
    }
  });

  it('es cero para un total no positivo', () => {
    expect(calculateCommission(0n, BP)).toBe(0n);
    expect(calculateCommission(-100n, BP)).toBe(0n);
  });

  it('el snapshot de la tasa coincide con el calculo', () => {
    // `commission_rate_at_transaction` es numeric(6,4) en el ERD.
    expect(basisPointsToRateSnapshot(BP)).toBe('0.0600');
    expect(calculateCommission(1_000_000n, BP)).toBe(
      BigInt(Math.round(1_000_000 * Number(basisPointsToRateSnapshot(BP)))),
    );
  });

  it('aplica la tasa que recibe, no una fija', () => {
    // Es lo que hace configurable a la comision: la funcion no conoce el 6%.
    expect(calculateCommission(10_000_000n, 700)).toBe(700_000n);
    expect(calculateCommission(10_000_000n, 0)).toBe(0n);
  });

  it('NO descuenta el costo de Mercado Pago (DEC-043)', () => {
    // Offside cobra su 6% integro; el costo de MP es independiente y lo
    // descuenta MP del lado del vendedor.
    expect(calculateCommission(10_000_000n, BP)).toBe(600_000n);
  });
});
