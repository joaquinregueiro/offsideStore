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

/**
 * La clave no admite ese scope, o el `scope_id` no apunta a nada.
 *
 * ⚠️ Codigo `VALIDATION_FAILED` (422) y no `SETTING_INVALID` (500): esto lo
 * provoca quien ESCRIBE —un administrador que eligio un tier que no existe o
 * un ambito que la clave no admite—, no data corrupta en la base. Es error
 * del cliente y merece un mensaje que lo explique, no un 500 que parezca un
 * bug del servidor.
 *
 * `scope_id` es FK LOGICA (ERD §17.1): PostgreSQL no puede verificarla porque
 * la tabla destino depende de `scope`. Este error es la validacion en app que
 * el ERD delega.
 */
export const settingScopeInvalid = (key: string, motivo: string): AuthError =>
  new AuthError('VALIDATION_FAILED', `La configuracion "${key}" no admite ese ambito: ${motivo}`);

/** La clave no existe en el registro (`settings-registry.ts`). */
export const settingUnknown = (key: string): AuthError =>
  new AuthError('VALIDATION_FAILED', `No existe la configuracion "${key}"`);

/**
 * El valor que se intenta ESCRIBIR no pasa el schema de su clave.
 *
 * Es el hermano de `settingInvalid` con la culpa al reves: aquel es un valor
 * que ya esta en la base y no deberia (500); este es un administrador que
 * mando algo fuera de rango y tiene que recibir un 422 que se lo explique,
 * no un error que parezca un bug del servidor. Nada llega a escribirse.
 */
export const settingValueRejected = (key: string, motivo: string): AuthError =>
  new AuthError('VALIDATION_FAILED', `El valor para "${key}" no es valido: ${motivo}`);
