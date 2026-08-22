/**
 * Errores del modulo auth.
 *
 * Son errores de DOMINIO: no conocen HTTP. El Controller los traduce a codigos
 * de estado (CLAUDE.md §8 — el Service no conoce HTTP).
 */

export type AuthErrorCode =
  | 'EMAIL_ALREADY_REGISTERED'
  | 'INVALID_CREDENTIALS'
  | 'EMAIL_NOT_VERIFIED'
  | 'ACCOUNT_NOT_ACTIVE'
  | 'INVALID_TOKEN'
  | 'SESSION_INVALID'
  | 'NOT_AUTHENTICATED'
  | 'FORBIDDEN'
  | 'SELLER_PROFILE_ALREADY_EXISTS'
  | 'TERMS_NOT_ACCEPTED'
  // --- sellers: identidad fiscal ---
  | 'VALIDATION_FAILED'
  | 'FISCAL_SOURCE_UNAVAILABLE';

export class AuthError extends Error {
  readonly code: AuthErrorCode;

  constructor(code: AuthErrorCode, message: string) {
    super(message);
    this.name = 'AuthError';
    this.code = code;
  }
}

/**
 * Credenciales invalidas.
 *
 * ⚠️ Mensaje DELIBERADAMENTE generico: no revela si el email existe o si la
 * password es incorrecta. Distinguirlos permitiria enumerar cuentas.
 */
export const invalidCredentials = (): AuthError =>
  new AuthError('INVALID_CREDENTIALS', 'Email o contrasena incorrectos');

export const emailAlreadyRegistered = (): AuthError =>
  new AuthError('EMAIL_ALREADY_REGISTERED', 'Ese email ya esta registrado');

/** BR-001: no se opera sin email verificado. */
export const emailNotVerified = (): AuthError =>
  new AuthError('EMAIL_NOT_VERIFIED', 'Tenes que verificar tu email antes de operar (BR-001)');

export const accountNotActive = (): AuthError =>
  new AuthError('ACCOUNT_NOT_ACTIVE', 'La cuenta no esta activa');

export const invalidToken = (): AuthError =>
  new AuthError('INVALID_TOKEN', 'El token es invalido o expiro');

export const sessionInvalid = (): AuthError =>
  new AuthError('SESSION_INVALID', 'La sesion es invalida o expiro');

export const notAuthenticated = (): AuthError =>
  new AuthError('NOT_AUTHENTICATED', 'Necesitas iniciar sesion');

export const forbidden = (): AuthError =>
  new AuthError('FORBIDDEN', 'No tenes permisos para esta accion');

export const sellerProfileAlreadyExists = (): AuthError =>
  new AuthError('SELLER_PROFILE_ALREADY_EXISTS', 'El usuario ya tiene perfil de vendedor');

export const termsNotAccepted = (): AuthError =>
  new AuthError('TERMS_NOT_ACCEPTED', 'Tenes que aceptar los terminos y la politica de privacidad');
