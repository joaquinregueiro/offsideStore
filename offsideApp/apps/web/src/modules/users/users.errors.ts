import { AuthError } from '../auth/auth.errors';

/**
 * Errores del modulo users.
 *
 * ⚠️ REUTILIZAN `AuthError` Y NO UNA CLASE PROPIA. No es pereza: `lib/http.ts`
 * traduce a HTTP por el `code` de `AuthError`, y `lib/errores.ts` convierte a
 * mensaje de pantalla lo que sea un `AuthError` —todo lo demas cae en "Tuvimos
 * un problema" y se registra como error inesperado—. Una clase propia habria
 * hecho que un nombre demasiado corto se le mostrara a la persona como una
 * falla del sitio.
 */

export const displayNameTooShort = (minimo: number): AuthError =>
  new AuthError('VALIDATION_FAILED', `El nombre tiene que tener al menos ${minimo} caracteres`);
