import { describe, expect, it } from 'vitest';

import { computeScore, scoreComponents, scoreToColumn, type ScoreInputs } from './reputation-score';
import { validators, type ScoreWeights } from './reputation-settings.service';

/**
 * Fórmula del score (DEC-036: derivado, nunca autoridad).
 *
 * Lo que se fija acá: que un componente sin datos se EXCLUYE y no vale cero,
 * que nunca hay división por cero y que el resultado cabe en `numeric(6,2)`.
 */

const PESOS: ScoreWeights = {
  rating: 0.4,
  sales: 0.2,
  dispatch: 0.2,
  cancellations: 0.1,
  claims: 0.1,
};

function inputs(overrides: Partial<ScoreInputs> = {}): ScoreInputs {
  return {
    salesCount: 0,
    cancellationsCount: 0,
    claimsCount: 0,
    avgDispatchHours: null,
    ratingAvg: null,
    ratingCount: 0,
    dispatchDeadlineHours: 72,
    ...overrides,
  };
}

describe('componentes del score', () => {
  it('sin datos, todo es null salvo ventas (que vale 0)', () => {
    expect(scoreComponents(inputs())).toEqual({
      rating: null,
      sales: 0,
      dispatch: null,
      cancellations: null,
      claims: null,
    });
  });

  it('rating: 1★ → 0, 3★ → 0,5, 5★ → 1', () => {
    expect(scoreComponents(inputs({ ratingAvg: 1, ratingCount: 1 })).rating).toBe(0);
    expect(scoreComponents(inputs({ ratingAvg: 3, ratingCount: 1 })).rating).toBe(0.5);
    expect(scoreComponents(inputs({ ratingAvg: 5, ratingCount: 1 })).rating).toBe(1);
  });

  it('ventas satura: 10 ventas → 0,5', () => {
    expect(scoreComponents(inputs({ salesCount: 10 })).sales).toBe(0.5);
    expect(scoreComponents(inputs({ salesCount: 990 })).sales).toBe(0.99);
  });

  it('despacho: inmediato → 1, al plazo → 0, pasado el plazo se recorta a 0', () => {
    expect(scoreComponents(inputs({ avgDispatchHours: 0 })).dispatch).toBe(1);
    expect(scoreComponents(inputs({ avgDispatchHours: 72 })).dispatch).toBe(0);
    expect(scoreComponents(inputs({ avgDispatchHours: 144 })).dispatch).toBe(0);
    expect(scoreComponents(inputs({ avgDispatchHours: 36 })).dispatch).toBe(0.5);
  });

  it('un plazo de 0 horas no divide por cero: el componente queda sin datos', () => {
    expect(
      scoreComponents(inputs({ avgDispatchHours: 10, dispatchDeadlineHours: 0 })).dispatch,
    ).toBeNull();
  });

  it('cancelaciones y reclamos se miden contra ventas + incidentes', () => {
    const c = scoreComponents(inputs({ salesCount: 8, cancellationsCount: 2, claimsCount: 1 }));
    expect(c.cancellations).toBeCloseTo(0.8, 10);
    expect(c.claims).toBeCloseTo(1 - 1 / 9, 10);
  });

  it('solo cancelaciones y ninguna venta: componente 0, no NaN', () => {
    const c = scoreComponents(inputs({ salesCount: 0, cancellationsCount: 3 }));
    expect(c.cancellations).toBe(0);
    expect(c.claims).toBeNull();
  });
});

describe('computeScore', () => {
  it('vendedor recién llegado: solo cuenta ventas, y vale 0', () => {
    expect(computeScore(inputs(), PESOS)).toBe(0);
  });

  it('sin reviews se excluye el rating y se renormalizan los pesos', () => {
    // sales 10 → 0,5 · dispatch 36 h → 0,5 · cancelaciones 1 · reclamos 1
    // (0,5·0,2 + 0,5·0,2 + 1·0,1 + 1·0,1) / (0,2+0,2+0,1+0,1) = 0,4 / 0,6
    const score = computeScore(inputs({ salesCount: 10, avgDispatchHours: 36 }), PESOS);
    expect(score).toBe(66.67);
  });

  it('el máximo es 100 y llega con datos perfectos', () => {
    const score = computeScore(
      inputs({ salesCount: 990, avgDispatchHours: 0, ratingAvg: 5, ratingCount: 20 }),
      PESOS,
    );
    // rating 1 · sales 0,99 · dispatch 1 · cancelaciones 1 · reclamos 1
    expect(score).toBe(99.8);
    expect(score).toBeLessThanOrEqual(100);
  });

  it('⚠️ si la suma de pesos con datos es cero devuelve null, no NaN', () => {
    // Solo pesa el rating y no hay reviews: no queda nada que promediar.
    const soloRating: ScoreWeights = {
      rating: 1,
      sales: 0,
      dispatch: 0,
      cancellations: 0,
      claims: 0,
    };
    expect(computeScore(inputs({ salesCount: 5 }), soloRating)).toBeNull();
  });

  it('un peso en cero apaga el componente sin romper el resto', () => {
    const sinVentas: ScoreWeights = { ...PESOS, sales: 0 };
    const score = computeScore(inputs({ ratingAvg: 5, ratingCount: 3, salesCount: 1 }), sinVentas);
    // (1·0,4) / 0,4 = 1 → 100; cancelaciones y reclamos valen 1 con peso 0,1 c/u → sigue 100
    expect(score).toBe(100);
  });

  it('redondea a dos decimales', () => {
    const score = computeScore(inputs({ ratingAvg: 4.333, ratingCount: 3 }), PESOS);
    expect(score).not.toBeNull();
    expect(String(score).split('.')[1]?.length ?? 0).toBeLessThanOrEqual(2);
  });
});

describe('scoreToColumn', () => {
  it('numeric(6,2) viaja como string con dos decimales', () => {
    expect(scoreToColumn(87.5)).toBe('87.50');
    expect(scoreToColumn(100)).toBe('100.00');
    expect(scoreToColumn(null)).toBeNull();
  });
});

describe('validación de la configuración', () => {
  it('pesos: exige los cinco, no negativos y con suma positiva', () => {
    expect(() => validators.assertScoreWeights({ ...PESOS, rating: -0.1 })).toThrow();
    expect(() => validators.assertScoreWeights({ rating: 1 })).toThrow();
    expect(() =>
      validators.assertScoreWeights({
        rating: 0,
        sales: 0,
        dispatch: 0,
        cancellations: 0,
        claims: 0,
      }),
    ).toThrow();
    expect(validators.assertScoreWeights(PESOS)).toEqual(PESOS);
  });

  it('umbrales: enteros crecientes CONFIABLE < DESTACADO < COLECCIONISTA', () => {
    expect(validators.assertThresholds({ CONFIABLE: 5, DESTACADO: 10, COLECCIONISTA: 20 })).toEqual(
      { CONFIABLE: 5, DESTACADO: 10, COLECCIONISTA: 20 },
    );
    expect(() =>
      validators.assertThresholds({ CONFIABLE: 10, DESTACADO: 10, COLECCIONISTA: 20 }),
    ).toThrow();
    expect(() =>
      validators.assertThresholds({ CONFIABLE: 5, DESTACADO: 10.5, COLECCIONISTA: 20 }),
    ).toThrow();
  });

  it('plazo de despacho: horas positivas', () => {
    expect(validators.assertDispatchDeadlineHours(72)).toBe(72);
    expect(() => validators.assertDispatchDeadlineHours(0)).toThrow();
    expect(() => validators.assertDispatchDeadlineHours('72')).toThrow();
  });
});
