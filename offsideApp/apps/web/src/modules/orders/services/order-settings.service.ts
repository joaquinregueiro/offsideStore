import type { Database } from '@offside/database';

import * as configErrors from '../../config/config.errors';
import * as orderRepo from '../repositories/order.repository';

/**
 * Los PLAZOS del ciclo de la orden, leidos del Config Store (DEC-029 /
 * DEC-033 / DEC-038; migracion `0010`).
 *
 * ⚠️ SIN DEFAULTS EN CODIGO. Si una clave no esta cargada se lanza
 * `SETTING_NOT_CONFIGURED`: es un problema de despliegue, no un caso a
 * tolerar con un numero inventado (`config.errors.ts`). Los tres valores
 * sembrados en `0010` estan marcados ASUMIDOS y pendientes de confirmacion.
 *
 * ⚠️ `dispatch_deadline_hours` admite override por tier (`settings-registry`
 * lo declara `GLOBAL_Y_TIER`). Aca se lee SOLO el global: resolver la
 * precedencia por tier es del Service de `config` (`resolveSetting`), que
 * todavia no existe. Anotado en NECESITA-DE-OTROS.
 */

export const PAYMENT_WINDOW_KEY = 'payment_window_minutes';
export const DISPATCH_DEADLINE_KEY = 'dispatch_deadline_hours';
export const BUYER_PROTECTION_KEY = 'buyer_protection_days';

async function leerEnteroPositivo(key: string, db?: Database): Promise<number> {
  const valor = await orderRepo.findGlobalSettingValue(key, db);
  if (valor === undefined) throw configErrors.settingNotConfigured(key);

  if (typeof valor !== 'number' || !Number.isInteger(valor) || valor <= 0) {
    throw configErrors.settingInvalid(key, 'debe ser un entero positivo');
  }

  return valor;
}

/** Minutos para pagar antes de que `PENDING_PAYMENT` venza (DEC-033). */
export async function getPaymentWindowMinutes(db?: Database): Promise<number> {
  return leerEnteroPositivo(PAYMENT_WINDOW_KEY, db);
}

/** Horas desde el pago para despachar (BR-032 / MF-030). Global. */
export async function getDispatchDeadlineHours(db?: Database): Promise<number> {
  return leerEnteroPositivo(DISPATCH_DEADLINE_KEY, db);
}

/** Dias desde la entrega para que la orden se cierre sola sin reclamo (BR-033). */
export async function getBuyerProtectionDays(db?: Database): Promise<number> {
  return leerEnteroPositivo(BUYER_PROTECTION_KEY, db);
}
