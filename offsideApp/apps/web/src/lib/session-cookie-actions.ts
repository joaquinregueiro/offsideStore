import { cookies } from 'next/headers';

import { SESSION_COOKIE_NAME, sessionCookieOptions } from './session-cookie';

/**
 * Escritura de la cookie de sesion desde SERVER ACTIONS.
 *
 * ⚠️ MISMAS OPCIONES QUE LA API, importadas de un solo lugar. Si `httpOnly` o
 * `sameSite` divergieran entre los dos caminos, la sesion creada por un
 * formulario tendria una proteccion distinta a la creada por el endpoint —y
 * nadie lo notaria hasta que fuera un problema.
 *
 * Escribir cookies solo esta permitido en Server Actions y Route Handlers; en
 * un Server Component que solo renderiza, `cookies()` es de lectura.
 */

export async function guardarSesion(token: string, expiraEn: Date): Promise<void> {
  (await cookies()).set({
    name: SESSION_COOKIE_NAME,
    value: token,
    ...sessionCookieOptions(),
    expires: expiraEn,
  });
}

/** Borra la cookie. `maxAge: 0` la expira en el acto. */
export async function borrarSesion(): Promise<void> {
  (await cookies()).set({
    name: SESSION_COOKIE_NAME,
    value: '',
    ...sessionCookieOptions(),
    maxAge: 0,
  });
}
