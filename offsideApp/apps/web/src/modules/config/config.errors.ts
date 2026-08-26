import { AuthError } from '../auth/auth.errors';

/**
 * Errores del Config Store.
 *
 * Reutilizan `AuthError` para que el mapa de traduccion a HTTP de `lib/http.ts`
 * siga siendo uno solo. No conocen HTTP.
 */

/**
 * La clave no esta cargada en `app_settings`.
 *
 * ⚠️ NO hay valor por defecto en codigo. Un fallback seria una segunda fuente
 * de verdad: el dia que alguien cambie el setting y el codigo siga teniendo su
 * propio numero, nadie sabria cual rigio. La clave se carga por migracion
 * (`0003_seed_commission_rate`), asi que faltar es un problema de despliegue,
 * no un caso normal a tolerar.
 */
export const settingNotConfigured = (key: string): AuthError =>
  new AuthError('SETTING_NOT_CONFIGURED', `La configuracion "${key}" no esta cargada`);

/** El valor guardado no tiene la forma que su clave exige. */
export const settingInvalid = (key: string, motivo: string): AuthError =>
  new AuthError('SETTING_INVALID', `La configuracion "${key}" es invalida: ${motivo}`);
