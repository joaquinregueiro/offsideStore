import { getEnv, requireEnv } from '@offside/config';

import {
  MercadoPagoOAuthError,
  type BuildAuthorizationUrlParams,
  type EncryptedMercadoPagoCredentials,
  type ExchangeAuthorizationCodeParams,
  type MercadoPagoOAuthPort,
} from './mercadopago-oauth.port';
import { encryptToken } from './token-cipher';

/**
 * Adapter HTTP de OAuth de Mercado Pago.
 *
 * UNICO lugar del sistema que conoce URLs, nombres de campo y credenciales de
 * Mercado Pago (spec §2, CLAUDE.md §11).
 *
 * ⚠️ REGLA DE LOGGING: en este archivo no se loguea NUNCA el cuerpo de una
 * request ni de una response. Ahi viajan `client_secret`, `code`,
 * `code_verifier`, `access_token` y `refresh_token` (spec §8). Lo unico que se
 * puede registrar es el codigo de estado HTTP.
 */

/**
 * URLs oficiales de Mercado Pago.
 *
 * Verificadas contra la documentacion oficial vigente (Split de Pagos /
 * Seguridad / OAuth, agosto 2026). **No se derivan de una suposicion ni se
 * configuran por entorno**: son parte del contrato del proveedor, iguales para
 * todos los paises, y ponerlas en el entorno solo abriria la puerta a apuntar
 * la aplicacion a un host arbitrario.
 *
 *   Autorizacion  https://auth.mercadopago.com/authorization
 *   Token         https://api.mercadopago.com/oauth/token
 *
 * Lo que SI es por entorno son las credenciales y el `redirect_uri`, que
 * dependen de la aplicacion registrada.
 */
const AUTHORIZATION_URL = 'https://auth.mercadopago.com/authorization';
const TOKEN_URL = 'https://api.mercadopago.com/oauth/token';

/**
 * `platform_id=mp` — valor fijo documentado para la URL de autorizacion
 * (spec §4).
 */
const PLATFORM_ID = 'mp';

/**
 * `offline_access` es lo que habilita renovar el token (MP-OAUTH-006). Sin el,
 * la conexion muere a los 180 dias y exige reconexion manual.
 *
 * ⚠️ Es el UNICO scope que se solicita. Si hacen falta otros, es una decision
 * que se toma con la documentacion de Mercado Pago delante, no aca (spec §20,
 * 🔵 pendiente).
 */
const SCOPE = 'offline_access';

/** Plazo maximo de la llamada a Mercado Pago. */
const REQUEST_TIMEOUT_MS = 10_000;

interface MercadoPagoConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

/**
 * Credenciales de la aplicacion registrada en Mercado Pago.
 *
 * Se exigen en el BORDE del modulo con `requireEnv()`, no en el esquema global
 * de entorno: el resto del sistema tiene que poder arrancar y testearse sin
 * credenciales de terceros (patron ya usado por `auth`).
 *
 * `MERCADOPAGO_REDIRECT_URI` no tiene fallback a `APP_URL` A PROPOSITO: Mercado
 * Pago exige coincidencia EXACTA con la URI registrada en la aplicacion, y un
 * fallback silencioso produciria un error remoto opaco en vez de un error local
 * claro.
 */
function config(): MercadoPagoConfig {
  const env = getEnv();

  return {
    clientId: requireEnv(env, 'MERCADOPAGO_CLIENT_ID'),
    clientSecret: requireEnv(env, 'MERCADOPAGO_CLIENT_SECRET'),
    redirectUri: requireEnv(env, 'MERCADOPAGO_REDIRECT_URI'),
  };
}

/** Respuesta del token tal como la documenta Mercado Pago (spec §20). */
interface TokenResponse {
  access_token?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
  scope?: unknown;
  user_id?: unknown;
  public_key?: unknown;
  live_mode?: unknown;
}

/**
 * `user_id` puede llegar como numero o como string segun el endpoint. Se
 * normaliza a string porque la columna del ERD es `text`.
 */
function readMpUserId(value: unknown): string | null {
  if (typeof value === 'string' && value.trim() !== '') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

/**
 * Mercado Pago documenta `scope` como cadena separada por espacios. Se acepta
 * tambien un arreglo por robustez, sin inventar un tercer formato.
 */
function readScopes(value: unknown): string[] | null {
  if (typeof value === 'string' && value.trim() !== '') return value.trim().split(/\s+/);
  if (Array.isArray(value)) {
    const scopes = value.filter((s): s is string => typeof s === 'string' && s !== '');
    return scopes.length > 0 ? scopes : null;
  }
  return null;
}

function readOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

export function createMercadoPagoOAuthClient(): MercadoPagoOAuthPort {
  return {
    buildAuthorizationUrl({ state, codeChallenge }: BuildAuthorizationUrlParams): string {
      const { clientId, redirectUri } = config();
      const url = new URL(AUTHORIZATION_URL);

      // Parametros de la spec §4. `code_challenge_method=S256` es obligatorio
      // para Offside aunque Mercado Pago admita `Plain` (MP-OAUTH-002).
      url.searchParams.set('client_id', clientId);
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('platform_id', PLATFORM_ID);
      url.searchParams.set('redirect_uri', redirectUri);
      url.searchParams.set('state', state);
      url.searchParams.set('code_challenge', codeChallenge);
      url.searchParams.set('code_challenge_method', 'S256');
      url.searchParams.set('scope', SCOPE);

      return url.toString();
    },

    async exchangeAuthorizationCode({
      code,
      codeVerifier,
    }: ExchangeAuthorizationCodeParams): Promise<EncryptedMercadoPagoCredentials> {
      const { clientId, clientSecret, redirectUri } = config();

      let response: Response;
      try {
        response = await fetch(TOKEN_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({
            client_id: clientId,
            client_secret: clientSecret,
            code,
            grant_type: 'authorization_code',
            redirect_uri: redirectUri,
            code_verifier: codeVerifier,
          }),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch (error) {
        // Sin respuesta: red, DNS o timeout. Se registra el TIPO de error, no
        // el error completo, que podria arrastrar la request.
        throw new MercadoPagoOAuthError(
          'unreachable',
          `No se pudo contactar a Mercado Pago (${error instanceof Error ? error.name : 'error desconocido'})`,
        );
      }

      if (!response.ok) {
        // ⚠️ El cuerpo del error NO se lee ni se propaga. Los codigos exactos
        // de Mercado Pago estan 🔵 pendientes (spec §11): mapearlos ahora seria
        // inventarlos. El estado HTTP alcanza para diagnosticar y no es secreto.
        throw new MercadoPagoOAuthError(
          'exchange_rejected',
          'Mercado Pago rechazo el intercambio del codigo de autorizacion',
          response.status,
        );
      }

      let payload: TokenResponse;
      try {
        payload = (await response.json()) as TokenResponse;
      } catch {
        throw new MercadoPagoOAuthError(
          'invalid_response',
          'La respuesta de Mercado Pago no es JSON valido',
          response.status,
        );
      }

      const accessToken = readOptionalString(payload.access_token);
      const mpUserId = readMpUserId(payload.user_id);
      const expiresIn = typeof payload.expires_in === 'number' ? payload.expires_in : null;

      if (accessToken === null) {
        throw new MercadoPagoOAuthError(
          'invalid_response',
          'La respuesta de Mercado Pago no incluye access_token',
          response.status,
        );
      }

      // ⚠️ `user_id` esta documentado para el flujo de refresh; que venga en el
      // de authorization_code esta 🔵 PENDIENTE de confirmar (MP-OAUTH-007 y
      // spec §20). La spec preve un fallback contra "un endpoint autenticado de
      // MP", pero NO dice cual, y ese endpoint no se inventa aca (CLAUDE.md
      // §16). Hasta confirmarlo, la ausencia falla de forma explicita: sin
      // `mp_user_id` no hay forma de saber que cuenta se conecto, y las reglas
      // de conflicto de la spec §9 dependen enteramente de ese dato.
      if (mpUserId === null) {
        throw new MercadoPagoOAuthError(
          'invalid_response',
          'La respuesta de Mercado Pago no incluye user_id',
          response.status,
        );
      }

      // Sin `expires_in` no se puede calcular el vencimiento. Suponer 180 dias
      // seria inventar un dato del proveedor.
      if (expiresIn === null) {
        throw new MercadoPagoOAuthError(
          'invalid_response',
          'La respuesta de Mercado Pago no incluye expires_in',
          response.status,
        );
      }

      const refreshToken = readOptionalString(payload.refresh_token);

      // ⚠️ EL CIFRADO OCURRE ACA, ANTES DE DEVOLVER: los secretos no cruzan la
      // frontera hacia el dominio en claro (spec §2 y §8).
      return {
        mpUserId,
        encryptedAccessToken: encryptToken(accessToken),
        encryptedRefreshToken: refreshToken === null ? null : encryptToken(refreshToken),
        expiresAt: new Date(Date.now() + expiresIn * 1000),
        scopes: readScopes(payload.scope),
        publicKey: readOptionalString(payload.public_key),
        liveMode: typeof payload.live_mode === 'boolean' ? payload.live_mode : null,
      };
    },
  };
}
