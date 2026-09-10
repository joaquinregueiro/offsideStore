import { headers } from 'next/headers';

import { rateLimited } from '@/modules/auth/auth.errors';

import {
  checkAccountLimit,
  consumeAccountLimit,
  consumeIpLimitFor,
  consumeUserLimit,
  registerFailedAttempt,
  type RateLimitScope,
} from './rate-limit';

/**
 * Rate limiting desde SERVER ACTIONS.
 *
 * =============================================================================
 * POR QUE EXISTE ESTE ARCHIVO
 * =============================================================================
 *
 * El limitador vivia SOLO en los Controllers, y las Server Actions llaman al
 * Service **directo**. Resultado: `POST /api/auth/login` estaba limitado y el
 * formulario de `/ingresar` **no**. La puerta protegida era la que casi nadie
 * usa; la pantalla, que es la que usa todo el mundo, estaba abierta.
 *
 * Dos consecuencias, y la segunda es peor que la primera:
 *
 *  1. **Credential stuffing.** Probar listas de credenciales filtradas de otros
 *     sitios sin techo de intentos. No hace falta adivinar nada: hace falta
 *     poder intentar muchas veces.
 *  2. **Agotamiento de recursos.** Las passwords se hashean con argon2id, que
 *     es lento y usa ~19 MB por intento a proposito. Sin techo, eso se vuelve
 *     en contra: cada intento fallido cuesta memoria y CPU del servidor. Un
 *     atacante no necesita acertar UNA sola password para voltear el sitio.
 *
 * =============================================================================
 *
 * ⚠️ MISMAS CLAVES QUE LA API. Se reusan las funciones de `rate-limit.ts`, asi
 * que el contador de la pantalla y el del endpoint son EL MISMO. Si fueran
 * claves distintas, un atacante bloqueado por un camino seguiria libre por el
 * otro y el limite no valdria nada.
 */

/**
 * IP del que llama, leida de las cabeceras de la request en curso.
 *
 * ⚠️ Replica la logica de `clientIp()` sobre `headers()` porque una Server
 * Action no tiene `Request`. El orden de preferencia y el trato de la cabecera
 * vacia son los mismos: una cabecera presente pero vacia no identifica a nadie.
 *
 * ⚠️ `x-forwarded-for` lo puede falsificar el cliente si la app NO esta detras
 * de un proxy de confianza que lo reescriba. En Coolify lo hace; exponer el
 * puerto de Next directo a internet volveria falsificable el limite por IP.
 */
async function ipDeLaAccion(): Promise<string> {
  const cabeceras = await headers();

  const forwarded = cabeceras.get('x-forwarded-for')?.split(',')[0]?.trim();
  if (forwarded !== undefined && forwarded !== '') return forwarded;

  const realIp = cabeceras.get('x-real-ip')?.trim();
  if (realIp !== undefined && realIp !== '') return realIp;

  return 'desconocida';
}

/**
 * Exige el limite POR IP. Lanza `RATE_LIMITED` si se paso.
 *
 * Va ANTES de parsear el formulario y de tocar la base: el sentido de un rate
 * limit es no gastar recursos en el intento numero mil.
 */
export async function exigirLimitePorIp(scope: RateLimitScope): Promise<void> {
  const decision = await consumeIpLimitFor(await ipDeLaAccion(), scope);
  if (!decision.allowed) throw rateLimited(decision.retryAfterSeconds);
}

/**
 * Exige el limite POR CUENTA **sin consumirlo**, para el login.
 *
 * ⚠️ NO CONSUME, Y ESO ES DELIBERADO. Si cada intento contara, cualquiera
 * podria dejar a una persona afuera de su propia cuenta mandando cinco intentos
 * con su email: la proteccion se convertiria en el ataque. El cupo lo consume
 * unicamente `registrarLoginFallido`.
 */
export async function exigirLimitePorCuenta(email: string): Promise<void> {
  const decision = await checkAccountLimit(email);
  if (!decision.allowed) throw rateLimited(decision.retryAfterSeconds);
}

/** Consume el cupo por cuenta tras un login FALLIDO. */
export async function registrarLoginFallido(email: string): Promise<void> {
  await registerFailedAttempt(email);
}

/**
 * Exige el limite POR CUENTA consumiendolo, para las acciones que MANDAN UN
 * EMAIL.
 *
 * Es el criterio inverso al del login, y es correcto en los dos casos: alli el
 * dano esta en el intento fallido; aca el intento EXITOSO es el dano, porque
 * manda un email real a una persona real.
 */
export async function exigirLimiteDeEnvio(scope: RateLimitScope, email: string): Promise<void> {
  const decision = await consumeAccountLimit(scope, email);
  if (!decision.allowed) throw rateLimited(decision.retryAfterSeconds);
}

/**
 * Exige el limite POR USUARIO. Es el que usan las acciones ya autenticadas.
 *
 * ⚠️ VA DESPUES DE RESOLVER LA SESION, no antes, y esa es la unica excepcion a
 * la regla de "el limite primero": no se puede contar por usuario sin saber
 * quien es. El orden correcto es igual el mas barato posible — resolver la
 * sesion es una lectura indexada, y todo lo caro (parsear el formulario,
 * decodificar imagenes, llamar a Mercado Pago) queda detras del limite.
 *
 * ⚠️ NO SE LIMITA POR IP. En auth la IP es lo unico que hay; aca hay identidad
 * verificada, que es una clave estrictamente mejor: no la comparte media
 * oficina detras de un NAT y no se rota gratis. El detalle esta en
 * `consumeUserLimit`.
 */
export async function exigirLimitePorUsuario(scope: RateLimitScope, userId: string): Promise<void> {
  const decision = await consumeUserLimit(scope, userId);
  if (!decision.allowed) throw rateLimited(decision.retryAfterSeconds);
}
