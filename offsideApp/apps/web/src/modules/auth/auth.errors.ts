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
  | 'RATE_LIMITED'
  // --- sellers: identidad fiscal ---
  | 'VALIDATION_FAILED'
  | 'FISCAL_SOURCE_UNAVAILABLE'
  // --- sellers: conexion con Mercado Pago (mercadopago-oauth-spec.md §13) ---
  | 'MP_SELLER_NOT_APPROVED'
  | 'MP_ALREADY_CONNECTED'
  | 'MP_NOT_CONNECTED'
  | 'MP_INVALID_STATE'
  | 'MP_EXCHANGE_FAILED'
  | 'MP_ACCOUNT_CONFLICT'
  | 'MP_CONNECTION_UNAVAILABLE'
  // --- payments (mercadopago-payments-spec.md) ---
  | 'ORDER_NOT_FOUND'
  | 'ORDER_NOT_PAYABLE'
  | 'PAYMENT_DEADLINE_EXPIRED'
  | 'PAYMENT_NOT_FOUND'
  | 'PAYMENT_NOT_REFUNDABLE'
  | 'PAYMENT_PROVIDER_ERROR'
  | 'REFUND_AMOUNT_INVALID'
  // --- orders ---
  | 'LISTING_NOT_AVAILABLE'
  | 'LISTING_OUT_OF_STOCK'
  | 'SELLER_NOT_OPERATIONAL'
  // --- listings: imagenes (PS-010 / PS-012) ---
  | 'LISTING_NOT_FOUND'
  | 'LISTING_IMAGE_NOT_FOUND'
  | 'IMAGE_INVALID'
  | 'IMAGE_TOO_LARGE'
  | 'TOO_MANY_IMAGES'
  | 'LAST_IMAGE_REQUIRED'
  // --- config store (configuration-registry.md) ---
  | 'SETTING_NOT_CONFIGURED'
  | 'SETTING_INVALID';

export class AuthError extends Error {
  readonly code: AuthErrorCode;
  /** Solo en RATE_LIMITED: alimenta el header `Retry-After`. */
  readonly retryAfterSeconds?: number;

  constructor(code: AuthErrorCode, message: string, retryAfterSeconds?: number) {
    super(message);
    this.name = 'AuthError';
    this.code = code;
    if (retryAfterSeconds !== undefined) this.retryAfterSeconds = retryAfterSeconds;
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

/**
 * Demasiados intentos (`security-observability-analytics.md` §1).
 *
 * ⚠️ Mensaje generico por el mismo motivo que `invalidCredentials`: no dice si
 * el bloqueo es por IP o por cuenta, ni si la cuenta existe.
 */
export const rateLimited = (retryAfterSeconds: number): AuthError =>
  new AuthError(
    'RATE_LIMITED',
    'Demasiados intentos. Espera unos minutos antes de volver a intentar',
    retryAfterSeconds,
  );
