import { AuthError } from '../auth/auth.errors';

/**
 * Errores de SELLER_TIER (DEC-015 / DEC-037) y del modo vacaciones.
 *
 * Reutilizan `AuthError` para que el mapa de traduccion a HTTP de `lib/http.ts`
 * siga siendo uno solo. No conocen HTTP.
 *
 * ⚠️ `AuthErrorCode` es una union cerrada que vive en `auth/auth.errors.ts` y
 * este paquete no la toca. Por eso se REUSAN codigos existentes con la
 * semantica mas cercana:
 *
 *   SETTING_NOT_CONFIGURED  → falta la fila de `seller_tiers` o la clave de
 *                             `app_settings` que la evaluacion necesita. Es un
 *                             problema de despliegue, igual que la comision.
 *   SETTING_INVALID         → la fila existe pero no tiene la forma esperada
 *                             (una tasa que no es numeric, un `limits` sin
 *                             umbral). Tambien es configuracion rota.
 *   VALIDATION_FAILED       → input del vendedor (la fecha de vacaciones).
 *
 * Si algun dia hace falta distinguirlos por HTTP, la salida es agregar
 * `SELLER_TIER_NOT_FOUND` y `SELLER_TIER_INVALID` a `AuthErrorCode`.
 */

/** No hay ningun tier activo en `seller_tiers`. La migracion `0010` los carga. */
export const noActiveTiers = (): AuthError =>
  new AuthError(
    'SETTING_NOT_CONFIGURED',
    'No hay niveles de vendedor configurados. Cargalos desde la administración',
  );

/** Se pidio un tier por `code` y no existe o esta inactivo. */
export const tierNotFound = (code: string): AuthError =>
  new AuthError(
    'SETTING_NOT_CONFIGURED',
    `El nivel de vendedor "${code}" no existe o está inactivo`,
  );

/**
 * Una fila de `seller_tiers` no tiene la forma que el Service exige.
 *
 * ⚠️ Nombra el `code` del tier y el motivo, nunca el valor crudo: `limits` y
 * `benefits` son JSON libres y podrian ser largos.
 */
export const tierInvalid = (code: string, motivo: string): AuthError =>
  new AuthError(
    'SETTING_INVALID',
    `El nivel de vendedor "${code}" está mal configurado: ${motivo}`,
  );

/** Una clave `seller_tier_*` de `app_settings` esta cargada con un valor invalido. */
export const tierSettingInvalid = (key: string, motivo: string): AuthError =>
  new AuthError('SETTING_INVALID', `La configuración "${key}" es inválida: ${motivo}`);

/* -------------------------------------------------------------------------- */
/* Modo vacaciones                                                             */
/* -------------------------------------------------------------------------- */

/** La fecha de regreso ya paso o no es una fecha. */
export const vacationDateInvalid = (): AuthError =>
  new AuthError('VALIDATION_FAILED', 'La fecha de regreso tiene que ser posterior a hoy');

/**
 * Cambiar el nivel a mano le cambia la comision al vendedor: sin motivo, la
 * auditoria registra el hecho y no la razon.
 */
export const tierReasonRequired = (): AuthError =>
  new AuthError('VALIDATION_FAILED', 'Indicá el motivo del cambio de nivel');
