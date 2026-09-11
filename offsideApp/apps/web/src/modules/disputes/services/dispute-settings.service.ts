import type { Database } from '@offside/database';

import * as configErrors from '../../config/config.errors';
import * as settingsRepo from '../repositories/dispute-settings.repository';
import type { ClaimWindowSettings } from './dispute-rules';

/**
 * Configuracion de los reclamos (⚙️ DEC-013 / DEC-038).
 *
 * Tres claves, y las tres son PLAZOS OPERATIVOS: se leen al momento de usarlos
 * y no se snapshotean (DEC-030 protege el dinero, no los relojes; mismo
 * criterio que `dispatch_deadline_hours` en `orders`).
 */

/** TS-052 ⚙️. La siembra la migracion `0010` (3 dias, asumido). */
export const SELLER_RESPONSE_DAYS_KEY = 'dispute_seller_response_days';
/** BR-032 ⚙️. La siembra la migracion `0010` (72 horas, asumido). */
export const DISPATCH_DEADLINE_HOURS_KEY = 'dispatch_deadline_hours';
/**
 * BR-034 / TS-050 ⚙️ — dias para reclamar desde la entrega (o el despacho).
 *
 * ⚠️ CLAVE NUEVA, SIN SEMILLA: ninguna migracion la carga y el registro de
 * `config` no la conoce. La ola pidio explicitamente "si no existe usa 7"
 * (`DISPUTE_WINDOW_DAYS_DEFAULT`), y es la UNICA excepcion a la regla de no
 * tener defaults en codigo: sin ella nadie podria reclamar. Sigue 🟡 y esta
 * anotada como ASUMIDA; cuando `packages/database` la siembre y `config` la
 * registre, el default de aca se borra y esto lanza como las otras dos.
 */
export const DISPUTE_WINDOW_DAYS_KEY = 'dispute_window_days';
export const DISPUTE_WINDOW_DAYS_DEFAULT = 7;

function assertDiasEnteros(key: string, value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw configErrors.settingInvalid(key, 'debe ser un entero de dias mayor a cero');
  }

  return value;
}

function assertHorasPositivas(key: string, value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw configErrors.settingInvalid(key, 'debe ser un numero de horas mayor a cero');
  }

  return value;
}

export async function getSellerResponseDays(db?: Database): Promise<number> {
  const valor = await settingsRepo.findCurrentValue(SELLER_RESPONSE_DAYS_KEY, db);
  if (valor === undefined) throw configErrors.settingNotConfigured(SELLER_RESPONSE_DAYS_KEY);

  return assertDiasEnteros(SELLER_RESPONSE_DAYS_KEY, valor);
}

export async function getDispatchDeadlineHours(db?: Database): Promise<number> {
  const valor = await settingsRepo.findCurrentValue(DISPATCH_DEADLINE_HOURS_KEY, db);
  if (valor === undefined) throw configErrors.settingNotConfigured(DISPATCH_DEADLINE_HOURS_KEY);

  return assertHorasPositivas(DISPATCH_DEADLINE_HOURS_KEY, valor);
}

export async function getDisputeWindowDays(db?: Database): Promise<number> {
  const valor = await settingsRepo.findCurrentValue(DISPUTE_WINDOW_DAYS_KEY, db);
  if (valor === undefined) return DISPUTE_WINDOW_DAYS_DEFAULT;

  return assertDiasEnteros(DISPUTE_WINDOW_DAYS_KEY, valor);
}

/** Lo que `claimEligibility` necesita, en una sola lectura. */
export async function getClaimWindowSettings(db?: Database): Promise<ClaimWindowSettings> {
  const [windowDays, dispatchDeadlineHours] = await Promise.all([
    getDisputeWindowDays(db),
    getDispatchDeadlineHours(db),
  ]);

  return { windowDays, dispatchDeadlineHours };
}

/** Expuestos para tests unitarios de la validacion. */
export const validators = { assertDiasEnteros, assertHorasPositivas };
