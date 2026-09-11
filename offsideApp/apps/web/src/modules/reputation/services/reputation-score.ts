import type { ScoreComponent, ScoreWeights } from './reputation-settings.service';

/**
 * Formula del score de reputacion — FUNCION PURA.
 *
 * ⚠️ EL SCORE ES DERIVADO Y NO ES AUTORIDAD (DEC-036 / TS-020 / TS-021). Sirve
 * para ordenar y analizar; la confianza se decide mirando el historial y las
 * metricas crudas, que se muestran al lado. Si esta formula cambia, se
 * recalcula todo desde `user_history_events` y nada se pierde.
 *
 * Los PESOS vienen de `app_settings.reputation_score_weights` (OQ-D4 🟡). La
 * FORMA de cada componente es una decision de implementacion (asumida,
 * confirmar) y esta escrita para que cada numero tenga una lectura obvia:
 *
 *   rating         (promedio - 1) / 4          1★ → 0, 5★ → 1
 *   sales          ventas / (ventas + 10)      saturante: 10 ventas → 0,5
 *   dispatch       1 - horas / plazo           despacho inmediato → 1, al plazo → 0
 *   cancellations  1 - canc / (ventas + canc)  sin cancelaciones → 1
 *   claims         1 - reclamos / (ventas + reclamos)
 *
 * Un componente SIN DATOS (sin reviews, sin despachos, sin operaciones) no vale
 * cero: se EXCLUYE y los pesos restantes se renormalizan. Un vendedor nuevo
 * sin reviews no tiene "rating 0", tiene rating desconocido; castigarlo por
 * eso convertiria el score en un contador de antiguedad. Si no hay ningun
 * componente con datos, el score es `null`.
 *
 * Resultado en 0..100 con dos decimales, que es lo que admite
 * `seller_reputations.score` (`numeric(6,2)`).
 */

export interface ScoreInputs {
  salesCount: number;
  cancellationsCount: number;
  claimsCount: number;
  /** Null cuando no hay despachos medidos. */
  avgDispatchHours: number | null;
  /** Null cuando no hay reviews. */
  ratingAvg: number | null;
  ratingCount: number;
  /** Plazo de despacho vigente (BR-032), en horas. */
  dispatchDeadlineHours: number;
}

/** Ventas a partir de las cuales el componente `sales` vale 0,5. */
const SALES_HALF_POINT = 10;

function clamp01(valor: number): number {
  if (valor < 0) return 0;
  if (valor > 1) return 1;
  return valor;
}

/**
 * Valor 0..1 de cada componente, o `null` si no hay datos para calcularlo.
 * Expuesto para poder mostrar el desglose y para tests.
 */
export function scoreComponents(inputs: ScoreInputs): Record<ScoreComponent, number | null> {
  const operaciones = inputs.salesCount;

  const rating =
    inputs.ratingCount > 0 && inputs.ratingAvg !== null
      ? clamp01((inputs.ratingAvg - 1) / 4)
      : null;

  const sales = operaciones / (operaciones + SALES_HALF_POINT);

  const dispatch =
    inputs.avgDispatchHours !== null && inputs.dispatchDeadlineHours > 0
      ? clamp01(1 - inputs.avgDispatchHours / inputs.dispatchDeadlineHours)
      : null;

  const baseCancelaciones = operaciones + inputs.cancellationsCount;
  const cancellations =
    baseCancelaciones > 0 ? clamp01(1 - inputs.cancellationsCount / baseCancelaciones) : null;

  const baseReclamos = operaciones + inputs.claimsCount;
  const claims = baseReclamos > 0 ? clamp01(1 - inputs.claimsCount / baseReclamos) : null;

  return { rating, sales, dispatch, cancellations, claims };
}

/**
 * Score 0..100, o `null` si ningun componente tiene datos.
 *
 * ⚠️ NUNCA divide por cero: si la suma de pesos de los componentes con datos
 * es cero (por ejemplo, solo hay ventas y el admin puso `sales: 0`), el
 * resultado es `null`, no `NaN`.
 */
export function computeScore(inputs: ScoreInputs, weights: ScoreWeights): number | null {
  const componentes = scoreComponents(inputs);

  let sumaPonderada = 0;
  let sumaPesos = 0;

  for (const [nombre, valor] of Object.entries(componentes) as [ScoreComponent, number | null][]) {
    if (valor === null) continue;

    const peso = weights[nombre];
    sumaPonderada += valor * peso;
    sumaPesos += peso;
  }

  if (sumaPesos <= 0) return null;

  return Math.round((sumaPonderada / sumaPesos) * 100 * 100) / 100;
}

/** `numeric(6,2)` viaja como string en Drizzle: `87.5` → `'87.50'`. */
export function scoreToColumn(score: number | null): string | null {
  return score === null ? null : score.toFixed(2);
}
