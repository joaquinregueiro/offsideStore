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
