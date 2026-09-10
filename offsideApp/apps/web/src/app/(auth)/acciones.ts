'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { respuestaDeError } from '@/lib/errores';
import { rutaInternaSegura } from '@/lib/formato';
import type { EstadoFormulario } from '@/lib/formulario';
import {
  exigirLimiteDeEnvio,
  exigirLimitePorCuenta,
  exigirLimitePorIp,
  registrarLoginFallido,
} from '@/lib/rate-limit-actions';
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
export type { EstadoFormulario } from '@/lib/formulario';

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
    // El limite va ANTES de parsear y de tocar la base: el sentido de un rate
    // limit es no gastar recursos en el intento numero mil.
    await exigirLimitePorIp('register');

    const input = registerSchema.parse({
      email: texto(formData, 'email'),
      password: texto(formData, 'password'),
      acceptedTerms: formData.get('acceptedTerms') === 'on',
    });

    await authService.register(input);
  } catch (error) {
    return respuestaDeError(error, { ambito: 'auth', formData, preservar: ['email'] });
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
    await exigirLimitePorIp('login');

    const input = loginSchema.parse({
      email: texto(formData, 'email'),
      password: texto(formData, 'password'),
    });

    // ⚠️ LIMITE POR CUENTA: lectura pura, NO consume cupo. Frena la fuerza
    // bruta distribuida, donde cada IP prueba pocas veces contra la misma
    // cuenta y por eso el limite por IP no la ve.
    await exigirLimitePorCuenta(input.email);

    let sesion;
    try {
      sesion = await authService.login(input);
    } catch (error) {
      // ⚠️ SOLO LOS FALLOS CONSUMEN EL CUPO DE LA CUENTA. Si lo consumiera
      // cualquier intento, mandar cinco con el email de otra persona la dejaria
      // afuera de su propia cuenta: la proteccion seria el ataque.
      if (error instanceof AuthError && error.code === 'INVALID_CREDENTIALS') {
        await registrarLoginFallido(input.email);
      }
      throw error;
    }

    await guardarSesion(sesion.sessionToken, sesion.expiresAt);
  } catch (error) {
    return respuestaDeError(error, { ambito: 'auth', formData, preservar: ['email'] });
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
    await exigirLimitePorIp('password-forgot');
    const input = forgotPasswordSchema.parse({ email: texto(formData, 'email') });

    // ⚠️ DOS LIMITES. Por IP, contra el abuso general; y por CUENTA, porque
    // esta accion manda un email REAL a una direccion real: sin el segundo,
    // repetir el POST desde IPs distintas inunda la casilla de un tercero y
    // quema la reputacion de envio del dominio.
    await exigirLimiteDeEnvio('password-forgot', input.email);

    // ⚠️ El Service devuelve `null` si el email no existe y NO se distingue:
    // responder distinto convertiria esta pantalla en un enumerador de cuentas.
    await authService.requestPasswordReset(input.email);
  } catch (error) {
    return respuestaDeError(error, { ambito: 'auth', formData, preservar: ['email'] });
  }

  redirect('/revisa-tu-email?motivo=reset');
}

/**
 * Reenvia el email de verificacion.
 *
 * ⚠️ NO REDIRIGE Y NO DISTINGUE. Se queda en la pantalla y responde siempre
 * lo mismo, exista la cuenta o no y este verificada o no: distinguir la
 * convertiria en un enumerador de cuentas.
 *
 * Antes de esto, `/verificar-email` prometia "Ingresa y te mandamos otro" y no
 * pasaba nada: no habia ningun camino para emitir un token nuevo.
 */
export async function reenviarVerificacion(
  _estado: EstadoFormulario,
  formData: FormData,
): Promise<EstadoFormulario> {
  try {
    await exigirLimitePorIp('verify-resend');
    const input = forgotPasswordSchema.parse({ email: texto(formData, 'email') });

    // Mismo motivo que en el reset: cada llamada exitosa manda un email a una
    // persona real.
    await exigirLimiteDeEnvio('verify-resend', input.email);

    await authService.resendEmailVerification(input.email);
  } catch (error) {
    return respuestaDeError(error, { ambito: 'auth', formData, preservar: ['email'] });
  }

  return {
    ok: 'Si esa cuenta existe y todavía no está verificada, te mandamos un email. Revisá también el correo no deseado.',
  };
}

export async function restablecerPassword(
  _estado: EstadoFormulario,
  formData: FormData,
): Promise<EstadoFormulario> {
  try {
    await exigirLimitePorIp('password-reset');

    const input = resetPasswordSchema.parse({
      token: texto(formData, 'token'),
      password: texto(formData, 'password'),
    });

    await authService.resetPassword(input.token, input.password);
  } catch (error) {
    return respuestaDeError(error, { ambito: 'auth', formData, preservar: ['email'] });
  }

  // Sin sesion automatica: `resetPassword` cierra TODAS las sesiones del
  // usuario a proposito, asi que corresponde volver a entrar.
  redirect('/ingresar?restablecida=1');
}
