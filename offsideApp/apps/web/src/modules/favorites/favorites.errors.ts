import { AuthError } from '../auth/auth.errors';

/**
 * Errores del modulo favorites (BS-050 / BS-051).
 *
 * Reutilizan `AuthError` con codigos que YA existen en `AuthErrorCode`: todo lo
 * que este modulo puede rechazar ya tiene un codigo con el mismo significado,
 * asi que el mapa HTTP de `lib/http.ts` y los mensajes de `lib/errores.ts`
 * funcionan sin tocar nada.
 */

/**
 * La publicacion no existe o esta eliminada.
 *
 * ⚠️ UN SOLO ERROR PARA LOS DOS CASOS, igual que en `listings`: distinguirlos
 * permitiria averiguar que ids existen probando.
 */
export const listingNotFound = (): AuthError =>
  new AuthError('LISTING_NOT_FOUND', 'Esa publicación no existe');

/** La configuracion de favoritos no esta cargada en `app_settings`. */
export const settingNotConfigured = (key: string): AuthError =>
  new AuthError('SETTING_NOT_CONFIGURED', `La configuración "${key}" no está cargada`);

export const settingInvalid = (key: string, motivo: string): AuthError =>
  new AuthError('SETTING_INVALID', `La configuración "${key}" es inválida: ${motivo}`);

/** Una baja de precio con importes que no son una baja (negativos, cero, o al reves). */
export const invalidPriceDrop = (motivo: string): AuthError =>
  new AuthError('VALIDATION_FAILED', `Baja de precio inválida: ${motivo}`);
