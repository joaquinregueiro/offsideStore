'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { rutaInternaSegura } from '@/lib/formato';
import { SESSION_COOKIE_NAME } from '@/lib/session-cookie';
import { borrarSesion, guardarSesion } from '@/lib/session-cookie-actions';
import { AuthError } from '@/modules/auth/auth.errors';
import {
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
} from '@/modules/auth/auth.schemas';
import * as authService from '@/modules/auth/services/auth.service';

/**
 * Server Actions de autenticacion.
 *
 * ⚠️ CADA ACCION VALIDA POR SU CUENTA. La documentacion de Next lo dice
 * explicito: "Server Functions are reachable via direct POST requests, not just
 * through your application's UI". Son endpoints, no funciones internas: que el
 * formulario tenga `required` no protege nada.
 *
 * ⚠️ REUSAN LOS MISMOS SCHEMAS DE ZOD QUE LOS ROUTE HANDLERS. La validacion vive
 * en `auth.schemas.ts` y las reglas en los Services; esto es solo otra puerta de
 * entrada. Duplicar la validacion garantizaria que las dos se desincronicen.
 */

/**
 * Lo que la accion devuelve al formulario.
 *
 * La mayoria de las acciones redirigen cuando salen bien, asi que solo tienen
 * `error`. `ok` existe para las que se quedan en la misma pantalla —cambiar la
 * comision, emitir un reembolso— y necesitan confirmar que algo paso.
 */
export interface EstadoFormulario {
  error?: string;
  ok?: string;
}

/**
 * Traduce un error de dominio a un mensaje para la persona.
 *
 * ⚠️ NO SE MUESTRA EL ERROR CRUDO. Un `AuthError` trae mensajes pensados para
 * el usuario, pero cualquier otra excepcion puede arrastrar detalle interno.
 * Lo desconocido se registra en el servidor y afuera sale un mensaje generico.
 */
function mensajeDeError(error: unknown): string {
  if (error instanceof z.ZodError) {
    return error.issues[0]?.message ?? 'Revisá los datos ingresados.';
  }

  if (error instanceof AuthError) return error.message;

  console.error('[auth] error inesperado en una accion:', error);

  return 'Tuvimos un problema. Probá de nuevo en un momento.';
}

/**
 * Lee un campo de texto del formulario.
 *
 * ⚠️ `FormData.get()` devuelve `string | File | null`: un campo puede llegar
 * como archivo aunque el formulario declare `type="text"`, porque el POST lo
 * arma el cliente y el cliente no es confiable. Sin este filtro, un `File`
 * terminaria convertido en la cadena `[object File]` y entrando al schema como
 * si fuera un valor legitimo.
 */
function texto(formData: FormData, nombre: string): string | undefined {
  const valor = formData.get(nombre);

  return typeof valor === 'string' ? valor : undefined;
}

/**
 * `redirect()` funciona lanzando una excepcion que Next intercepta.
 *
 * ⚠️ POR ESO NUNCA VA DENTRO DE UN `try`: el `catch` la atraparia y la
 * navegacion no ocurriria, dejando a la persona en la misma pantalla sin
 * explicacion. Todos los `redirect` de este archivo estan fuera del try.
 */

export async function crearCuenta(
  _estado: EstadoFormulario,
  formData: FormData,
): Promise<EstadoFormulario> {
  try {
    const input = registerSchema.parse({
      email: texto(formData, 'email'),
      password: texto(formData, 'password'),
      acceptedTerms: formData.get('acceptedTerms') === 'on',
    });

    await authService.register(input);
  } catch (error) {
    return { error: mensajeDeError(error) };
  }

  // ⚠️ NO se inicia sesion automaticamente. BR-001 exige email verificado para
  // operar, y crear la sesion aca daria la impresion de que ya puede comprar.
  redirect('/revisa-tu-email');
}

export async function ingresar(
  _estado: EstadoFormulario,
  formData: FormData,
): Promise<EstadoFormulario> {
  const destino = rutaInternaSegura(texto(formData, 'next'));

  try {
    const input = loginSchema.parse({
      email: texto(formData, 'email'),
      password: texto(formData, 'password'),
    });

    const { sessionToken, expiresAt } = await authService.login(input);
    await guardarSesion(sessionToken, expiresAt);
  } catch (error) {
    return { error: mensajeDeError(error) };
  }

  redirect(destino);
}

export async function salir(): Promise<void> {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;

  // ⚠️ Se INVALIDA la sesion en la base, no alcanza con borrar la cookie: el
  // token seguiria siendo valido para cualquiera que lo tuviera copiado.
  //
  // Cerrar sesion sin sesion no es un error —un doble clic, una pestaña vieja—:
  // se limpia la cookie igual y se sigue.
  if (token !== undefined && token !== '') await authService.logout(token);

  await borrarSesion();
  redirect('/');
}

export async function pedirResetDePassword(
  _estado: EstadoFormulario,
  formData: FormData,
): Promise<EstadoFormulario> {
  try {
    const input = forgotPasswordSchema.parse({ email: texto(formData, 'email') });

    // ⚠️ El Service devuelve `null` si el email no existe y NO se distingue:
    // responder distinto convertiria esta pantalla en un enumerador de cuentas.
    await authService.requestPasswordReset(input.email);
  } catch (error) {
    return { error: mensajeDeError(error) };
  }

  redirect('/revisa-tu-email?motivo=reset');
}

export async function restablecerPassword(
  _estado: EstadoFormulario,
  formData: FormData,
): Promise<EstadoFormulario> {
  try {
    const input = resetPasswordSchema.parse({
      token: texto(formData, 'token'),
      password: texto(formData, 'password'),
    });

    await authService.resetPassword(input.token, input.password);
  } catch (error) {
    return { error: mensajeDeError(error) };
  }

  // Sin sesion automatica: `resetPassword` cierra TODAS las sesiones del
  // usuario a proposito, asi que corresponde volver a entrar.
  redirect('/ingresar?restablecida=1');
}
