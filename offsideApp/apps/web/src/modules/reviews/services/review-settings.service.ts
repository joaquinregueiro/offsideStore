import type { Database } from '@offside/database';

import * as configErrors from '../../config/config.errors';
import * as settingsRepo from '../repositories/review-settings.repository';

/**
 * Configuracion ⚙️ de las calificaciones (DEC-013 / DEC-038).
 *
 * Las dos claves las siembra la migracion `0010`: `review_window_days` (30,
 * plazo 🟡 asumido; ERD §15 solo dice "solo COMPLETED") y `feature_reviews`
 * (`true`, configuration-registry §3). Viven en `app_settings` para que el
 * owner las cierre desde admin, sin deploy.
 *
 * ⚠️ SIN VALOR POR DEFECTO EN CODIGO, mismo criterio que la comision: un
 * fallback seria una segunda fuente de verdad. Si la clave falta, se lanza.
 */

export const REVIEW_WINDOW_DAYS_KEY = 'review_window_days';
export const FEATURE_REVIEWS_KEY = 'feature_reviews';

function assertWindowDays(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw configErrors.settingInvalid(
      REVIEW_WINDOW_DAYS_KEY,
      'debe ser un entero de dias mayor o igual a 1',
    );
  }

  return value;
}

function assertBool(key: string, value: unknown): boolean {
  if (typeof value !== 'boolean') {
    throw configErrors.settingInvalid(key, 'debe ser true o false');
  }

  return value;
}

/** Dias desde `orders.completed_at` durante los cuales se puede calificar. */
export async function getReviewWindowDays(db?: Database): Promise<number> {
  const valor = await settingsRepo.findCurrentValue(REVIEW_WINDOW_DAYS_KEY, db);
  if (valor === undefined) throw configErrors.settingNotConfigured(REVIEW_WINDOW_DAYS_KEY);

  return assertWindowDays(valor);
}

export async function areReviewsEnabled(db?: Database): Promise<boolean> {
  const valor = await settingsRepo.findCurrentValue(FEATURE_REVIEWS_KEY, db);
  if (valor === undefined) throw configErrors.settingNotConfigured(FEATURE_REVIEWS_KEY);

  return assertBool(FEATURE_REVIEWS_KEY, valor);
}

/** Expuestos para tests unitarios de la validacion. */
export const validators = { assertWindowDays, assertBool };
