import { unstable_rethrow } from 'next/navigation';
import { z } from 'zod';

import { AuthError } from '@/modules/auth/auth.errors';

import { erroresDeZod, valoresDelFormulario, type EstadoFormulario } from './formulario';

/**
 * Traduccion de excepciones a respuesta de formulario.
 *
 * ⚠️ ESTABA COPIADO IDENTICO EN LOS CUATRO `acciones.ts`. La unica diferencia
 * entre las cuatro copias era el prefijo del `console.error`. Cualquier mejora
 * —el enlace de salida, los errores por campo, el plazo del rate limit— habia
 * que hacerla cuatro veces, y bastaba con olvidarse de una para que un grupo de
 * rutas se quedara atras.
 */

/**
 * ⚠️ `unstable_rethrow` VA PRIMERO Y NO ES OPCIONAL. En Next, `redirect()` y
 * `notFound()` funcionan LANZANDO una excepcion de control. Los guards de
 * sesion se llaman DENTRO del `try` de cada accion, asi que ese `throw` caia en
 * el `catch` y se convertia en "Tuvimos un problema": con la sesion vencida,
 * quien apretaba Guardar no iba al login, recibia un error generico, y cada
 * reintento repetia el mismo error sin ninguna salida.
 */
export function mensajeDeError(error: unknown, ambito: string): string {
  unstable_rethrow(error);

  if (error instanceof z.ZodError) {
    return error.issues[0]?.message ?? 'Revisá los datos ingresados.';
  }

  if (error instanceof AuthError) return conEspera(error);

  console.error(`[${ambito}] error inesperado en una accion:`, error);

  return 'Tuvimos un problema. Probá de nuevo en un momento.';
}

/**
 * Le agrega el plazo al mensaje de un bloqueo por rate limit.
 *
 * ⚠️ EL NUMERO SE CALCULABA Y SE TIRABA. `lib/rate-limit.ts` saca el TTL exacto
 * de Redis y lo pone en `retryAfterSeconds`; la API lo manda en la cabecera
 * `Retry-After` y la pantalla decia "unos minutos". Un bloqueo sin plazo se lee
 * como una cuenta rota.
 *
 * ⚠️ SE REDONDEA A MINUTOS HACIA ARRIBA, no se dice el segundo exacto. "Faltan
 * 431 segundos" no ayuda a nadie, y ademas el segundo exacto delataria si el
 * contador que se agoto fue el de la IP o el de la cuenta.
 */
function conEspera(error: AuthError): string {
  const segundos = error.retryAfterSeconds;
  if (segundos === undefined || segundos <= 0) return error.message;

  const minutos = Math.ceil(segundos / 60);

  return `${error.message}. Probá de nuevo en ${minutos === 1 ? 'un minuto' : `${minutos} minutos`}.`;
}

/**
 * La respuesta completa para el `catch` de una Server Action: mensaje, errores
 * por campo, valores a restaurar y salida.
 */
export function respuestaDeError(
  error: unknown,
  opciones: {
    ambito: string;
    /** El `FormData` recibido, para poder devolver lo que se escribio. */
    formData?: FormData;
    /** Que campos restaurar. `valoresDelFormulario` filtra los sensibles. */
    preservar?: readonly string[];
  },
): EstadoFormulario {
  const respuesta: EstadoFormulario = { error: mensajeDeError(error, opciones.ambito) };

  if (error instanceof z.ZodError) {
    const errores = erroresDeZod(error);
    if (Object.keys(errores).length > 0) respuesta.errores = errores;
  }

  if (opciones.formData !== undefined && opciones.preservar !== undefined) {
    const valores = valoresDelFormulario(opciones.formData, opciones.preservar);
    if (Object.keys(valores).length > 0) respuesta.valores = valores;
  }

  const salida = enlaceDeError(error);
  if (salida !== undefined) respuesta.enlace = salida;

  return respuesta;
}

/**
 * La salida que le corresponde a un error, si tiene una.
 *
 * ⚠️ SE DECIDE POR `code`, NO POR EL TEXTO. El mensaje es presentacion y puede
 * reescribirse; el codigo es el contrato del dominio. Encadenar el enlace al
 * texto haria que una correccion de ortografia rompiera la navegacion.
 */
function enlaceDeError(error: unknown): EstadoFormulario['enlace'] {
  if (!(error instanceof AuthError)) return undefined;

  if (error.code === 'EMAIL_ALREADY_REGISTERED') {
    return { href: '/ingresar', texto: 'Ingresar con esa cuenta' };
  }

  if (error.code === 'EMAIL_NOT_VERIFIED') {
    return { href: '/revisa-tu-email', texto: 'Reenviar el email de verificación' };
  }

  if (error.code === 'INVALID_TOKEN') {
    return { href: '/olvide-password', texto: 'Pedir un enlace nuevo' };
  }

  return undefined;
}
