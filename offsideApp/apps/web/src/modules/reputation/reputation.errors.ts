import { AuthError } from '../auth/auth.errors';

/**
 * Errores del modulo reputation.
 *
 * Reutilizan `AuthError` para que el mapa de traduccion a HTTP de `lib/http.ts`
 * siga siendo uno solo. No conocen HTTP.
 *
 * ⚠️ `AuthErrorCode` es una union cerrada que vive en `auth/auth.errors.ts`
 * (no es de este modulo), asi que aca se reusan codigos existentes con el
 * estado HTTP mas cercano, igual que hace `sellers/seller.errors.ts`. Cuando
 * se agreguen codigos propios (`USER_NOT_FOUND`, `SELLER_NOT_FOUND`) alcanza
 * con cambiar el primer argumento de cada constructor.
 */

/** El vendedor no existe. Mismo criterio que `sellers`: 403 generico. */
export const sellerNotFound = (): AuthError => new AuthError('FORBIDDEN', 'Ese vendedor no existe');

/** El usuario al que se quiere cambiar el nivel no existe. */
export const userNotFound = (): AuthError =>
  new AuthError('VALIDATION_FAILED', 'Ese usuario no existe');

/**
 * Otorgar TIENDA es una accion administrativa (DEC-020: "categoria especial
 * otorgada por Offside"). Sin la capacidad, 403.
 */
export const levelGrantForbidden = (): AuthError =>
  new AuthError('FORBIDDEN', 'No tenés permiso para otorgar niveles de usuario');

/** Un hook recibio una orden que no esta en el estado que el hecho exige. */
export const orderNotInState = (orderId: string, esperado: string, actual: string): AuthError =>
  new AuthError(
    'VALIDATION_FAILED',
    `La orden ${orderId} está en ${actual}, y este hecho exige ${esperado}`,
  );

/** La orden no existe. Mismo codigo que usa `payments`. */
export const orderNotFound = (): AuthError =>
  new AuthError('ORDER_NOT_FOUND', 'Esa orden no existe');

/** BR-052: toda decision administrativa queda auditada con su motivo. */
export const reasonRequired = (): AuthError =>
  new AuthError('VALIDATION_FAILED', 'Indicá el motivo del cambio de nivel');

export const reasonTooLong = (max: number): AuthError =>
  new AuthError('VALIDATION_FAILED', `El motivo no puede superar ${max} caracteres`);
