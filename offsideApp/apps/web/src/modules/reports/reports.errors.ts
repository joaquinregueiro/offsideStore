import { AuthError } from '../auth/auth.errors';

/**
 * Errores del modulo reports (denuncias de publicaciones; delta al ERD del
 * 2026-09-10, tabla `listing_reports`).
 *
 * Reutilizan `AuthError` con los codigos existentes que traducen al HTTP
 * correcto, igual que `listings` y `favorites`. Cuando `AuthErrorCode`
 * incorpore `REPORT_NOT_FOUND` y `ALREADY_REPORTED`, migrar es cambiar el
 * codigo aca.
 */

/** La publicacion no existe o esta eliminada. Un solo error para los dos casos. */
export const listingNotFound = (): AuthError =>
  new AuthError('LISTING_NOT_FOUND', 'Esa publicación no existe');

/** Denunciar la propia publicacion. */
export const cannotReportOwnListing = (): AuthError =>
  new AuthError('FORBIDDEN', 'No podés denunciar tu propia publicación');

/** El motivo no esta en `REPORT_REASONS`. */
export const invalidReason = (): AuthError =>
  new AuthError('VALIDATION_FAILED', 'Elegí un motivo de la lista');

export const reportInvalid = (motivo: string): AuthError =>
  new AuthError('VALIDATION_FAILED', motivo);

/**
 * Ya hay una denuncia de esta persona sobre esta publicacion y moderacion ya
 * la atendio: no se reabre ni se cambia.
 */
export const alreadyReported = (): AuthError =>
  new AuthError('VALIDATION_FAILED', 'Ya denunciaste esta publicación y moderación la revisó');

/**
 * La denuncia no existe o ya no esta abierta. Un solo error para los dos:
 * el back-office no necesita distinguirlos y afuera no se enumera nada.
 */
export const reportNotOpen = (): AuthError =>
  new AuthError('VALIDATION_FAILED', 'Esa denuncia no existe o ya fue resuelta');
