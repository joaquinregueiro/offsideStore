import type { Database } from '@offside/database';

import * as configErrors from '../../config/config.errors';
import * as settingsRepo from '../repositories/reputation-settings.repository';

/**
 * Configuracion de reputacion y niveles (⚙️ DEC-013 / DEC-038).
 *
 * Las tres claves las siembra la migracion `0010` y sus valores son ASUMIDOS
 * (`erd-delta-2026-09-10.md` §5): los umbrales de DEC-020 son "preliminares",
 * los pesos del score son OQ-D4 🟡 y el plazo de despacho es BR-032 🟡. Por
 * eso viven en `app_settings` y no en el codigo: cuando el owner los cierre se
 * cambian desde admin, sin deploy.
 *
 * ⚠️ SIN VALOR POR DEFECTO EN CODIGO, mismo criterio que la comision: un
 * fallback seria una segunda fuente de verdad. Si la clave falta, se lanza.
 * Los valores se validan con `typeof`, no con `value_type` (convencion del
 * codigo, ver el delta §5).
 */

export const SCORE_WEIGHTS_KEY = 'reputation_score_weights';
export const USER_LEVEL_THRESHOLDS_KEY = 'user_level_thresholds';
export const DISPATCH_DEADLINE_HOURS_KEY = 'dispatch_deadline_hours';

/** Los cinco componentes del score, en el orden de la semilla. */
export const SCORE_COMPONENTS = ['rating', 'sales', 'dispatch', 'cancellations', 'claims'] as const;

export type ScoreComponent = (typeof SCORE_COMPONENTS)[number];

export type ScoreWeights = Record<ScoreComponent, number>;

/**
 * Niveles que se alcanzan POR UMBRAL. `NUEVO` es el piso y `TIENDA` no esta
 * porque DEC-020 la define como otorgada por Offside, no por actividad.
 */
export const THRESHOLD_LEVELS = ['CONFIABLE', 'DESTACADO', 'COLECCIONISTA'] as const;

export type ThresholdLevel = (typeof THRESHOLD_LEVELS)[number];

export type UserLevelThresholds = Record<ThresholdLevel, number>;

function assertScoreWeights(value: unknown): ScoreWeights {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw configErrors.settingInvalid(SCORE_WEIGHTS_KEY, 'debe ser un objeto con los cinco pesos');
  }

  const pesos = value as Record<string, unknown>;
  const resultado = {} as ScoreWeights;
  let suma = 0;

  for (const componente of SCORE_COMPONENTS) {
    const peso = pesos[componente];

    if (typeof peso !== 'number' || !Number.isFinite(peso) || peso < 0) {
      throw configErrors.settingInvalid(
        SCORE_WEIGHTS_KEY,
        `el peso "${componente}" debe ser un numero mayor o igual a cero`,
      );
    }

    resultado[componente] = peso;
    suma += peso;
  }

  // Con todos los pesos en cero no hay formula: cualquier score seria 0/0.
  if (suma <= 0) {
    throw configErrors.settingInvalid(SCORE_WEIGHTS_KEY, 'al menos un peso debe ser mayor a cero');
  }

  return resultado;
}

function assertThresholds(value: unknown): UserLevelThresholds {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw configErrors.settingInvalid(
      USER_LEVEL_THRESHOLDS_KEY,
      'debe ser un objeto con los umbrales por nivel',
    );
  }

  const umbrales = value as Record<string, unknown>;
  const resultado = {} as UserLevelThresholds;
  let anterior = 0;

  for (const nivel of THRESHOLD_LEVELS) {
    const umbral = umbrales[nivel];

    if (typeof umbral !== 'number' || !Number.isInteger(umbral) || umbral < 1) {
      throw configErrors.settingInvalid(
        USER_LEVEL_THRESHOLDS_KEY,
        `el umbral de ${nivel} debe ser un entero mayor o igual a 1`,
      );
    }

    // La progresion es NUEVO → CONFIABLE → DESTACADO → COLECCIONISTA (DEC-020):
    // un umbral que no crece haria inalcanzable o trivial al siguiente.
    if (umbral <= anterior) {
      throw configErrors.settingInvalid(
        USER_LEVEL_THRESHOLDS_KEY,
        `el umbral de ${nivel} debe ser mayor que el del nivel anterior`,
      );
    }

    resultado[nivel] = umbral;
    anterior = umbral;
  }

  return resultado;
}

function assertDispatchDeadlineHours(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw configErrors.settingInvalid(
      DISPATCH_DEADLINE_HOURS_KEY,
      'debe ser un numero de horas mayor a cero',
    );
  }

  return value;
}

export async function getScoreWeights(db?: Database): Promise<ScoreWeights> {
  const valor = await settingsRepo.findCurrentValue(SCORE_WEIGHTS_KEY, db);
  if (valor === undefined) throw configErrors.settingNotConfigured(SCORE_WEIGHTS_KEY);

  return assertScoreWeights(valor);
}

export async function getUserLevelThresholds(db?: Database): Promise<UserLevelThresholds> {
  const valor = await settingsRepo.findCurrentValue(USER_LEVEL_THRESHOLDS_KEY, db);
  if (valor === undefined) throw configErrors.settingNotConfigured(USER_LEVEL_THRESHOLDS_KEY);

  return assertThresholds(valor);
}

/**
 * Plazo de despacho (BR-032 / SS-081). Lo usa el score para saber que es
 * "despachar a tiempo": la misma clave que gobierna el plazo real, para que
 * la reputacion no juzgue con una vara distinta de la que se le exige.
 */
export async function getDispatchDeadlineHours(db?: Database): Promise<number> {
  const valor = await settingsRepo.findCurrentValue(DISPATCH_DEADLINE_HOURS_KEY, db);
  if (valor === undefined) throw configErrors.settingNotConfigured(DISPATCH_DEADLINE_HOURS_KEY);

  return assertDispatchDeadlineHours(valor);
}

/** Expuestos para tests unitarios de la validacion. */
export const validators = { assertScoreWeights, assertThresholds, assertDispatchDeadlineHours };
