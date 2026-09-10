import { getEnv } from '@offside/config';
import type { NextResponse } from 'next/server';

/**
 * Cookie de sesion.
 *
 * Decisiones y su motivo:
 *  - `httpOnly`: JavaScript no puede leerla → un XSS no roba la sesion.
 *  - `sameSite: 'lax'`: mitiga CSRF sin romper la navegacion normal.
 *  - `secure` fuera de desarrollo: en local no hay HTTPS y la cookie no viajaria.
 *  - `path: '/'`: la sesion aplica a toda la app.
 *
 * `security-observability-analytics.md` §1 pide "sesiones seguras" y proteccion
 * CSRF y XSS; estas banderas son la parte que corresponde a la cookie.
 */

export const SESSION_COOKIE_NAME = 'offside_session';

/**
 * Opciones de la cookie, en UN solo lugar.
 *
 * Las usan los dos caminos que crean sesion: los Route Handlers (via
 * `setSessionCookie`) y las Server Actions (via `session-cookie-actions.ts`).
 * Si divergieran, una sesion tendria distinta proteccion segun por donde se
 * creo, y nadie lo notaria hasta que fuera un problema.
 */
export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: getEnv().APP_ENV !== 'development',
    path: '/',
  } as const;
}

export function setSessionCookie(response: NextResponse, token: string, expiresAt: Date): void {
  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: token,
    ...sessionCookieOptions(),
    expires: expiresAt,
  });
}

/** Borra la cookie. `maxAge: 0` la expira en el acto. */
export function clearSessionCookie(response: NextResponse): void {
  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: '',
    ...sessionCookieOptions(),
    maxAge: 0,
  });
}

/**
 * Lee el token de la request.
 *
 * Acepta ademas `Authorization: Bearer <token>` para clientes que no manejan
 * cookies (tests de integracion, herramientas de linea de comandos). La cookie
 * tiene prioridad.
 */
export function readSessionToken(request: Request): string | null {
  const cookie = request.headers
    .get('cookie')
    ?.split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${SESSION_COOKIE_NAME}=`));

  if (cookie) {
    const value = cookie.slice(SESSION_COOKIE_NAME.length + 1);
    if (value) return decodeURIComponent(value);
  }

  const auth = request.headers.get('authorization');
  if (auth?.toLowerCase().startsWith('bearer ')) {
    const value = auth.slice(7).trim();
    if (value) return value;
  }

  return null;
}
