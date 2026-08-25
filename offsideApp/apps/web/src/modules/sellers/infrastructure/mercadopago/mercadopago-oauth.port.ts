/**
 * Puerto de OAuth de Mercado Pago.
 *
 * Es la INTERFAZ que el dominio conoce (`architecture.md` §3.1 y §5). Todo lo
 * que sea especifico de Mercado Pago —URLs, nombres de campos, codigos de
 * error, credenciales— vive detras de esta frontera, en el adapter.
 *
 * FRONTERA DE SECRETOS (spec §2 y §8): los tokens se cifran DENTRO de
 * infraestructura, antes de cruzar hacia el Service. Por eso este puerto no
 * expone `accessToken` ni `refreshToken`, solo sus versiones cifradas. El
 * dominio no puede filtrar un secreto que nunca recibe.
 */

/**
 * Credenciales listas para persistir. **Todos los secretos ya vienen cifrados.**
 *
 * Los nombres de campo son de Offside, no de Mercado Pago: el dominio no habla
 * el idioma del proveedor.
 */
export interface EncryptedMercadoPagoCredentials {
  /** Cuenta de Mercado Pago a la que pertenecen las credenciales. */
  mpUserId: string;
  encryptedAccessToken: string;
  /** Ausente si Mercado Pago no devolvio `refresh_token`. */
  encryptedRefreshToken: string | null;
  expiresAt: Date;
  scopes: string[] | null;
  /** Publica por diseno: es la clave de cliente. NO se cifra (spec §8). */
  publicKey: string | null;
  /** `false` en credenciales de prueba. */
  liveMode: boolean | null;
}

/**
 * Motivos por los que puede fallar una operacion contra Mercado Pago.
 *
 * ⚠️ DELIBERADAMENTE GRUESOS. Los codigos de error exactos de Mercado Pago
 * estan 🔵 PENDIENTES de validar en la primera integracion (spec §11 y §20):
 * mapearlos ahora seria inventarlos. Estas categorias se derivan de lo que si
 * es observable —hubo respuesta o no, fue 2xx o no, el cuerpo tenia los campos
 * necesarios o no— y no de la taxonomia de errores del proveedor.
 */
export type MercadoPagoOAuthFailure =
  /** Mercado Pago rechazo el intercambio (code vencido, PKCE incorrecto, etc.). */
  | 'exchange_rejected'
  /** No hubo respuesta: red caida, timeout, DNS. */
  | 'unreachable'
  /** Respondio 2xx pero el cuerpo no trae lo que hace falta para persistir. */
  | 'invalid_response';

/**
 * Error de la integracion con Mercado Pago.
 *
 * ⚠️ NUNCA lleva el cuerpo de la respuesta ni ningun parametro de la request:
 * ahi viajan `code`, `code_verifier` y `client_secret` (spec §8). Solo lleva la
 * categoria y, si la hubo, el codigo de estado HTTP, que no es un secreto.
 */
export class MercadoPagoOAuthError extends Error {
  readonly failure: MercadoPagoOAuthFailure;
  readonly httpStatus?: number;

  constructor(failure: MercadoPagoOAuthFailure, message: string, httpStatus?: number) {
    super(message);
    this.name = 'MercadoPagoOAuthError';
    this.failure = failure;
    if (httpStatus !== undefined) this.httpStatus = httpStatus;
  }
}

export interface BuildAuthorizationUrlParams {
  state: string;
  codeChallenge: string;
}

export interface ExchangeAuthorizationCodeParams {
  /**
   * `authorization_code` recibido en el callback.
   *
   * ⚠️ Es una credencial de un solo uso: no se persiste, no se audita y no se
   * loguea (spec §7).
   */
  code: string;
  codeVerifier: string;
}

export interface MercadoPagoOAuthPort {
  /** URL a la que el FRONTEND debe navegar (MP-OAUTH-014). */
  buildAuthorizationUrl(params: BuildAuthorizationUrlParams): string;

  /** Canjea el code por credenciales cifradas. */
  exchangeAuthorizationCode(
    params: ExchangeAuthorizationCodeParams,
  ): Promise<EncryptedMercadoPagoCredentials>;
}
