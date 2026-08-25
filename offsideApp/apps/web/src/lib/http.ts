import { NextResponse } from 'next/server';
import { ZodError } from 'zod';

import { AuthError, type AuthErrorCode } from '@/modules/auth/auth.errors';

/**
 * Traduccion de errores de dominio a HTTP.
 *
 * Es la UNICA capa que conoce codigos de estado. Los Services lanzan errores de
 * dominio y no saben nada de HTTP (CLAUDE.md §8).
 */

/** Mapa explicito: un error nuevo sin entrada aca cae en 500, que es lo correcto. */
const STATUS_BY_CODE: Record<AuthErrorCode, number> = {
  EMAIL_ALREADY_REGISTERED: 409,
  INVALID_CREDENTIALS: 401,
  EMAIL_NOT_VERIFIED: 403,
  ACCOUNT_NOT_ACTIVE: 403,
  INVALID_TOKEN: 400,
  SESSION_INVALID: 401,
  NOT_AUTHENTICATED: 401,
  FORBIDDEN: 403,
  SELLER_PROFILE_ALREADY_EXISTS: 409,
  TERMS_NOT_ACCEPTED: 422,
  /** Demasiados intentos: el cliente puede reintentar mas tarde. */
  RATE_LIMITED: 429,
  /** Identificador fiscal sintacticamente invalido. */
  VALIDATION_FAILED: 422,
  /** No hay integracion con la fuente fiscal: no es culpa del cliente. */
  FISCAL_SOURCE_UNAVAILABLE: 503,

  // --- Mercado Pago (mercadopago-oauth-spec.md §13) ---
  /** El vendedor todavia no esta aprobado: conflicto de estado, no de permisos. */
  MP_SELLER_NOT_APPROVED: 409,
  MP_ALREADY_CONNECTED: 409,
  MP_NOT_CONNECTED: 409,
  /** `state` invalido, vencido, reusado o de otra sesion. */
  MP_INVALID_STATE: 400,
  /** Mercado Pago rechazo el intercambio: el fallo es aguas arriba, no del cliente. */
  MP_EXCHANGE_FAILED: 502,
  MP_ACCOUNT_CONFLICT: 409,
  /** No se pudo preparar la conexion (Redis no acepto el contexto). */
  MP_CONNECTION_UNAVAILABLE: 503,

  // --- Payments (mercadopago-payments-spec.md) ---
  ORDER_NOT_FOUND: 404,
  /** La orden existe pero su estado no admite pago. */
  ORDER_NOT_PAYABLE: 409,
  PAYMENT_DEADLINE_EXPIRED: 409,
  PAYMENT_NOT_FOUND: 404,
  PAYMENT_NOT_REFUNDABLE: 409,
  /** Mercado Pago rechazo o no respondio: el fallo es aguas arriba. */
  PAYMENT_PROVIDER_ERROR: 502,
  REFUND_AMOUNT_INVALID: 422,

  // --- Orders ---
  /** La publicacion no existe o no admite compra. */
  LISTING_NOT_AVAILABLE: 409,
  LISTING_OUT_OF_STOCK: 409,
  /** El vendedor no puede operar: sin aprobar o sin Mercado Pago conectado. */
  SELLER_NOT_OPERATIONAL: 409,
};

export function ok<T>(data: T, status = 200): NextResponse {
  return NextResponse.json(data, { status });
}

export function fail(
  code: string,
  message: string,
  status: number,
  headers?: Record<string, string>,
): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status, ...(headers && { headers }) });
}

/** Errores de validacion de Zod: 422 con el detalle por campo. */
export function validationFailed(error: ZodError): NextResponse {
  return NextResponse.json(
    {
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Los datos enviados no son validos',
        fields: error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      },
    },
    { status: 422 },
  );
}

/**
 * Convierte cualquier excepcion en una respuesta.
 *
 * ⚠️ Un error inesperado se registra completo en el servidor pero NUNCA se
 * devuelve al cliente: el mensaje podria filtrar detalles internos.
 */
export function handleError(error: unknown): NextResponse {
  if (error instanceof ZodError) return validationFailed(error);

  if (error instanceof AuthError) {
    // `Retry-After` es lo que convierte un 429 en algo accionable: sin el, el
    // cliente solo puede adivinar cuando reintentar.
    const headers =
      error.retryAfterSeconds === undefined
        ? undefined
        : { 'Retry-After': String(error.retryAfterSeconds) };

    return fail(error.code, error.message, STATUS_BY_CODE[error.code], headers);
  }

  console.error('[api] error no controlado:', error);
  return fail('INTERNAL_ERROR', 'Ocurrio un error inesperado', 500);
}

/** Lee y parsea el body JSON. Un body malformado es 422, no 500. */
export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return {};
  }
}
