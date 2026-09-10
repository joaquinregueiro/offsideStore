import { getEnv } from '@offside/config';
import type { NextResponse } from 'next/server';

import { requireUser } from '@/lib/auth-guard';
import { handleError, ok, readJson } from '@/lib/http';
import {
  checkAccountLimit,
  consumeAccountLimit,
  consumeIpLimit,
  registerFailedAttempt,
  type RateLimitScope,
} from '@/lib/rate-limit';
import { clearSessionCookie, readSessionToken, setSessionCookie } from '@/lib/session-cookie';

import * as errors from '../auth.errors';
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

/**
 * Consume el limite por IP y corta si se supero.
 *
 * Va ANTES de parsear el body y de tocar la base: el sentido de un rate limit
 * es no gastar recursos en el intento numero mil.
 */
async function enforceIpLimit(request: Request, scope: RateLimitScope): Promise<void> {
  const decision = await consumeIpLimit(request, scope);
  if (!decision.allowed) throw errors.rateLimited(decision.retryAfterSeconds);
}

/** Fuera de desarrollo nunca se devuelve un token por la API. */
function exposeTokenInDev(token: string): { devToken?: string } {
  return getEnv().APP_ENV === 'development' ? { devToken: token } : {};
}

export async function register(request: Request): Promise<NextResponse> {
  try {
    await enforceIpLimit(request, 'register');
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
    await enforceIpLimit(request, 'login');
    const input = loginSchema.parse(await readJson(request));

    // Limite por cuenta: lectura pura, no consume cupo. Frena la fuerza bruta
    // distribuida, donde cada IP prueba pocas veces contra la misma cuenta.
    const account = await checkAccountLimit(input.email);
    if (!account.allowed) throw errors.rateLimited(account.retryAfterSeconds);

    let result;
    try {
      result = await authService.login(input, {
        userAgent: request.headers.get('user-agent') ?? undefined,
        // `x-forwarded-for` puede traer una cadena de proxies; el primero es el cliente.
        ip: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim(),
      });
    } catch (error) {
      // Solo los FALLOS consumen el cupo de la cuenta: un login exitoso no debe
      // acercar al usuario legitimo a su propio bloqueo.
      if (error instanceof errors.AuthError && error.code === 'INVALID_CREDENTIALS') {
        await registerFailedAttempt(input.email);
      }
      throw error;
    }

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
 * Reenvio del email de verificacion.
 *
 * ⚠️ LA RESPUESTA ES SIEMPRE LA MISMA: exista o no el email, este verificado o
 * no. Distinguir convertiria el endpoint en un enumerador de cuentas y, peor,
 * revelaria cuales estan sin verificar.
 *
 * ⚠️ LO QUE NO SE IGUALA ES EL TIEMPO. Una cuenta que existe y no esta
 * verificada hace un INSERT y encola un job; una inexistente corta en el
 * SELECT. La diferencia es medible con suficientes muestras. Es la misma
 * exposicion que ya tiene `requestPasswordReset` y se acota por el mismo lado:
 * el rate limit. Igualarla exigiria trabajo ficticio equivalente, como el hash
 * de descarte del login.
 *
 * ⚠️ DOBLE LIMITE, Y EL DE CUENTA ES EL QUE IMPORTA. Cada llamada exitosa
 * manda un email REAL a una persona real, asi que el limite por IP no alcanza:
 * repitiendo el POST desde IPs distintas se inunda la casilla de un tercero y
 * se quema la reputacion de envio del dominio. Por eso se consume tambien el
 * cupo POR CUENTA, contando todos los intentos y no solo los fallidos.
 *
 * El limite por cuenta va DESPUES de validar el cuerpo: sin un email valido no
 * hay cuenta contra la cual contar.
 *
 * Se reusa `forgotPasswordSchema` porque el cuerpo es identico —un email— y son
 * la misma regla de validacion. Duplicarlo garantizaria que se separen.
 */
export async function resendVerification(request: Request): Promise<NextResponse> {
  try {
    await enforceIpLimit(request, 'verify-resend');
    const { email } = forgotPasswordSchema.parse(await readJson(request));

    const cuenta = await consumeAccountLimit('verify-resend', email);
    if (!cuenta.allowed) throw errors.rateLimited(cuenta.retryAfterSeconds);
    const token = await authService.resendEmailVerification(email);

    return ok({
      message: 'Si esa cuenta existe y todavia no esta verificada, te mandamos un email',
      ...(token ? exposeTokenInDev(token) : {}),
    });
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
    await enforceIpLimit(request, 'password-forgot');
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
    await enforceIpLimit(request, 'password-reset');
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
