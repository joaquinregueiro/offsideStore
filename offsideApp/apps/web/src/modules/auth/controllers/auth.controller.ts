import { getEnv } from '@offside/config';
import type { NextResponse } from 'next/server';

import { requireUser } from '@/lib/auth-guard';
import { handleError, ok, readJson } from '@/lib/http';
import { clearSessionCookie, readSessionToken, setSessionCookie } from '@/lib/session-cookie';

import {
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
  verifyEmailSchema,
} from '../auth.schemas';
import * as authService from '../services/auth.service';

/**
 * Controller de auth: valida el input del borde, llama al Service y traduce el
 * resultado a HTTP. NO tiene reglas de negocio.
 */

/** Fuera de desarrollo nunca se devuelve un token por la API. */
function exposeTokenInDev(token: string): { devToken?: string } {
  return getEnv().APP_ENV === 'development' ? { devToken: token } : {};
}

export async function register(request: Request): Promise<NextResponse> {
  try {
    const input = registerSchema.parse(await readJson(request));
    const result = await authService.register(input);

    /**
     * ⚠️ El token de verificacion deberia enviarse por email. Todavia no hay
     * modulo de notificaciones ni proveedor de correo configurado, asi que en
     * desarrollo se devuelve para poder completar el flujo. En produccion no se
     * expone: quedaria pendiente de envio.
     */
    return ok({ user: result.user, ...exposeTokenInDev(result.emailVerificationToken) }, 201);
  } catch (error) {
    return handleError(error);
  }
}

export async function login(request: Request): Promise<NextResponse> {
  try {
    const input = loginSchema.parse(await readJson(request));

    const result = await authService.login(input, {
      userAgent: request.headers.get('user-agent') ?? undefined,
      // `x-forwarded-for` puede traer una cadena de proxies; el primero es el cliente.
      ip: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim(),
    });

    const response = ok({ user: result.user });
    setSessionCookie(response, result.sessionToken, result.expiresAt);
    return response;
  } catch (error) {
    return handleError(error);
  }
}

/**
 * Logout. Siempre responde 200 y borra la cookie, aunque el token ya no fuera
 * valido: el resultado deseado —quedar sin sesion— se cumple igual.
 */
export async function logout(request: Request): Promise<NextResponse> {
  try {
    const token = readSessionToken(request);
    if (token) await authService.logout(token);

    const response = ok({ loggedOut: true });
    clearSessionCookie(response);
    return response;
  } catch (error) {
    return handleError(error);
  }
}

export async function me(request: Request): Promise<NextResponse> {
  try {
    return ok({ user: await requireUser(request) });
  } catch (error) {
    return handleError(error);
  }
}

export async function verifyEmail(request: Request): Promise<NextResponse> {
  try {
    const { token } = verifyEmailSchema.parse(await readJson(request));
    return ok({ user: await authService.verifyEmail(token) });
  } catch (error) {
    return handleError(error);
  }
}

/**
 * Solicitud de reset de password.
 *
 * ⚠️ Responde SIEMPRE lo mismo, exista o no el email. Si distinguiera, seria un
 * enumerador de cuentas.
 */
export async function forgotPassword(request: Request): Promise<NextResponse> {
  try {
    const { email } = forgotPasswordSchema.parse(await readJson(request));
    const token = await authService.requestPasswordReset(email);

    return ok({
      message: 'Si el email esta registrado, vas a recibir instrucciones para recuperar tu cuenta',
      ...(token ? exposeTokenInDev(token) : {}),
    });
  } catch (error) {
    return handleError(error);
  }
}

export async function resetPassword(request: Request): Promise<NextResponse> {
  try {
    const { token, password } = resetPasswordSchema.parse(await readJson(request));
    await authService.resetPassword(token, password);

    // La password cambio y se cerraron todas las sesiones: la cookie actual ya
    // no sirve, asi que se limpia.
    const response = ok({ passwordReset: true });
    clearSessionCookie(response);
    return response;
  } catch (error) {
    return handleError(error);
  }
}
