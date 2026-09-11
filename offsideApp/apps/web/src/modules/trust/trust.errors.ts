import { AuthError, type AuthErrorCode } from '../auth/auth.errors';

/**
 * Errores del modulo trust (sanciones).
 *
 * Reutilizan `AuthError` para que el mapa de traduccion a HTTP de `lib/http.ts`
 * siga siendo uno solo. No conocen HTTP.
 *
 * ⚠️ `AuthErrorCode` es una union CERRADA que vive en `auth/auth.errors.ts` y
 * en `lib/http.ts`, y ninguno de los dos pertenece a este modulo. Por eso cada
 * error lleva DOS codigos: `code` es uno ya existente —el que `lib/http.ts`
 * sabe traducir— y `reason` es el motivo preciso, para que las pantallas y los
 * tests distingan "esa sancion no existe" de "esa sancion ya fue levantada"
 * sin tener que leer el mensaje. Cuando `auth.errors.ts` incorpore los codigos
 * de este modulo, `reason` pasa a ser `code` y nada mas cambia.
 */

export type TrustErrorReason =
  'SANCTION_NOT_FOUND' | 'SANCTION_NOT_ACTIVE' | 'SANCTION_INVALID' | 'SELLER_NOT_FOUND';

export class TrustError extends AuthError {
  readonly reason: TrustErrorReason;

  constructor(code: AuthErrorCode, reason: TrustErrorReason, message: string) {
    super(code, message);
    this.name = 'TrustError';
    this.reason = reason;
  }
}

export const sanctionNotFound = (): TrustError =>
  new TrustError('LISTING_NOT_FOUND', 'SANCTION_NOT_FOUND', 'Esa sanción no existe');

export const sanctionNotActive = (): TrustError =>
  new TrustError('LISTING_DELETED', 'SANCTION_NOT_ACTIVE', 'Esa sanción ya no está vigente');

export const sanctionInvalid = (motivo: string): TrustError =>
  new TrustError('VALIDATION_FAILED', 'SANCTION_INVALID', motivo);

export const sellerNotFound = (): TrustError =>
  new TrustError('LISTING_NOT_FOUND', 'SELLER_NOT_FOUND', 'Ese vendedor no existe');
