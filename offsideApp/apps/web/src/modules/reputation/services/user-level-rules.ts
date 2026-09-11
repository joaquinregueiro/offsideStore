import type { ThresholdLevel, UserLevelThresholds } from './reputation-settings.service';

/**
 * Reglas del NIVEL DE USUARIO (DEC-020) y de la etiqueta de reputacion
 * (TS-021) — FUNCIONES PURAS, sin base ni reloj.
 *
 * El nivel es TRAYECTORIA, no confianza ni riesgo (DEC-022 / TS-047): se
 * muestra como estatus y no habilita nada por si solo. Tres ejes, tres
 * columnas, y este archivo solo decide el primero.
 *
 * ⚠️ QUE CUENTA COMO "COMPRAS Y VENTAS" SIGUE 🟡 (TS-046). Aca se ASUME, a
 * confirmar por el owner: la SUMA de compras completadas (`PURCHASE_COMPLETED`)
 * y ventas completadas (`SALE_COMPLETED`) del historial, sin canceladas ni
 * reembolsadas (BR-051). Cambiarlo es cambiar `LEVEL_EVENT_TYPES`, en un solo
 * lugar. Los UMBRALES no estan aca: viven en `app_settings.user_level_thresholds`
 * (⚙️ DEC-013) y llegan por parametro.
 */

export const USER_LEVELS = ['NUEVO', 'CONFIABLE', 'DESTACADO', 'COLECCIONISTA', 'TIENDA'] as const;

export type UserLevel = (typeof USER_LEVELS)[number];

/** Texto visible de cada nivel, con tildes. No hay niveles fuera de DEC-020. */
export const LEVEL_LABELS: Readonly<Record<UserLevel, string>> = {
  NUEVO: 'Nuevo',
  CONFIABLE: 'Confiable',
  DESTACADO: 'Destacado',
  COLECCIONISTA: 'Coleccionista',
  TIENDA: 'Tienda',
};

/**
 * Hechos del historial que suman para el nivel (ASUMIDO, ver arriba). Son
 * SOLO los de ordenes `COMPLETED`: una orden cancelada no emite ninguno de
 * los dos.
 */
export const LEVEL_EVENT_TYPES = ['PURCHASE_COMPLETED', 'SALE_COMPLETED'] as const;

/** Posicion en la progresion. TIENDA es la ultima aunque no se alcance por umbral. */
export function levelRank(level: UserLevel): number {
  return USER_LEVELS.indexOf(level);
}

/**
 * Nivel que corresponde a `operations` operaciones completadas: el mas alto
 * cuyo umbral ya se alcanzo, o NUEVO. TIENDA nunca sale de aca (DEC-020: la
 * otorga Offside).
 */
export function levelForOperations(
  operations: number,
  thresholds: UserLevelThresholds,
): ThresholdLevel | 'NUEVO' {
  let alcanzado: ThresholdLevel | 'NUEVO' = 'NUEVO';

  for (const nivel of ['CONFIABLE', 'DESTACADO', 'COLECCIONISTA'] as const) {
    if (operations >= thresholds[nivel]) alcanzado = nivel;
  }

  return alcanzado;
}

export type LevelChangeReason = 'umbral_alcanzado' | 'sin_cambio' | 'tienda_manual' | 'no_baja';

export interface LevelDecision {
  from: UserLevel;
  to: UserLevel;
  changed: boolean;
  reason: LevelChangeReason;
}

/**
 * Decide si el nivel cambia, y a cual.
 *
 *  - TIENDA no se evalua: la puso una persona y solo una persona la saca.
 *  - El nivel NUNCA BAJA solo (ASUMIDO). Los hechos que suman no desaparecen,
 *    asi que la unica forma de "bajar" seria que un admin suba los umbrales;
 *    degradar a todo el mundo por una edicion de configuracion no es una
 *    "progresion de estatus" (DEC-020). Si hiciera falta, es una decision.
 */
export function decideLevelChange(
  current: UserLevel,
  operations: number,
  thresholds: UserLevelThresholds,
): LevelDecision {
  if (current === 'TIENDA') {
    return { from: current, to: current, changed: false, reason: 'tienda_manual' };
  }

  const objetivo = levelForOperations(operations, thresholds);

  if (levelRank(objetivo) > levelRank(current)) {
    return { from: current, to: objetivo, changed: true, reason: 'umbral_alcanzado' };
  }

  if (levelRank(objetivo) < levelRank(current)) {
    return { from: current, to: current, changed: false, reason: 'no_baja' };
  }

  return { from: current, to: current, changed: false, reason: 'sin_cambio' };
}

/**
 * Ventas completadas por debajo de las cuales el vendedor se presenta como
 * "Nuevo" en la ficha, sin importar su nivel de usuario: alguien puede ser
 * COLECCIONISTA comprando y no haber vendido nunca.
 *
 * ⚠️ ASUMIDO (constante documentada, no ⚙️): la doc no fija cuando un
 * vendedor deja de ser nuevo. Es presentacion, no regla de negocio: no
 * habilita ni bloquea nada.
 */
export const NEW_SELLER_SALES_THRESHOLD = 3;

/**
 * Etiqueta legible para la ficha, el perfil y el panel (TS-021): "Nuevo"
 * hasta `NEW_SELLER_SALES_THRESHOLD` ventas, y despues el nombre del NIVEL DE
 * USUARIO (DEC-020). No se inventan niveles: son los cinco de la doc.
 */
export function reputationLabel(salesCount: number, userLevel: UserLevel): string {
  if (salesCount < NEW_SELLER_SALES_THRESHOLD) return LEVEL_LABELS.NUEVO;

  return LEVEL_LABELS[userLevel];
}
