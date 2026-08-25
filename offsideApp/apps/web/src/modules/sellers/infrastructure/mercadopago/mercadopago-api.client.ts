import { decryptToken } from './token-cipher';

/**
 * Ejecutor de llamadas autenticadas a la API de Mercado Pago **como el
 * vendedor**.
 *
 * ⚠️ ES EL UNICO LUGAR, JUNTO CON `token-cipher.ts`, QUE VE UN ACCESS TOKEN EN
 * CLARO. Lo descifra, lo pone en el header, y lo descarta. No lo devuelve, no
 * lo loguea y no lo guarda (spec de OAuth §8, MP-OAUTH-015).
 *
 * POR QUE VIVE EN `sellers` Y NO EN `payments`: el dueño de la conexion OAuth
 * es `sellers`. `payments` decide QUE pedir; `sellers` decide CON QUE IDENTIDAD
 * se pide. Asi no hay una segunda implementacion de OAuth ni un segundo lugar
 * donde un token pueda filtrarse (mercadopago-payments-spec.md §4.1).
 */

/**
 * Host de la API de Mercado Pago.
 *
 * Constante, no configuracion: es parte del contrato del proveedor. Ver la nota
 * equivalente en `mercadopago-oauth.client.ts`.
 */
const API_BASE_URL = 'https://api.mercadopago.com';

/** Plazo maximo de una llamada. Igual criterio que el cliente de OAuth. */
const REQUEST_TIMEOUT_MS = 10_000;

export interface AuthorizedRequest {
  /** Path relativo al host de MP. Ej. `/checkout/preferences`. */
  path: string;
  method: 'GET' | 'POST' | 'PUT';
  body?: unknown;
  /**
   * `X-Idempotency-Key`. Mercado Pago lo exige en las APIs de Payments y
   * Refunds; enviarlo de mas no molesta y evita cobros o devoluciones dobles
   * ante un reintento.
   */
  idempotencyKey?: string;
}

export interface AuthorizedResponse {
  status: number;
  ok: boolean;
  /** Cuerpo ya parseado. `null` si no habia cuerpo o no era JSON. */
  body: unknown;
}

/** Falla de transporte: no hubo respuesta de Mercado Pago. */
export class MercadoPagoUnreachableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MercadoPagoUnreachableError';
  }
}

/**
 * Ejecuta la llamada con el token del vendedor.
 *
 * Recibe el token **cifrado** y lo descifra aca adentro: quien llama —el
 * Service de `sellers`— nunca lo tiene en claro.
 *
 * ⚠️ No interpreta el resultado. Devuelve estado y cuerpo tal cual para que la
 * semantica la ponga el modulo que sabe de pagos. Tampoco loguea: el cuerpo
 * puede contener datos sensibles.
 */
export async function requestWithEncryptedToken(
  encryptedAccessToken: string,
  request: AuthorizedRequest,
): Promise<AuthorizedResponse> {
  const accessToken = decryptToken(encryptedAccessToken);

  const headers: Record<string, string> = {
    authorization: `Bearer ${accessToken}`,
    accept: 'application/json',
  };

  if (request.body !== undefined) headers['content-type'] = 'application/json';
  if (request.idempotencyKey !== undefined) {
    headers['x-idempotency-key'] = request.idempotencyKey;
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${request.path}`, {
      method: request.method,
      headers,
      ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    // Se registra el TIPO de error, nunca el error completo: podria arrastrar
    // la request, y ahi viaja el token.
    throw new MercadoPagoUnreachableError(
      `No se pudo contactar a Mercado Pago (${error instanceof Error ? error.name : 'error desconocido'})`,
    );
  }

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // Sin cuerpo o cuerpo no-JSON: es legitimo en algunas respuestas. Quien
    // llama decide si eso es un error.
    body = null;
  }

  return { status: response.status, ok: response.ok, body };
}
