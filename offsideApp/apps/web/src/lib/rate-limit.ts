import { createHmac } from 'node:crypto';

import { getEnv, requireEnv } from '@offside/config';
import { getRedisClient } from '@offside/jobs';

/**
 * Rate limiting de los endpoints de auth no autenticados.
 *
 * POR QUE EXISTE: `security-observability-analytics.md` §1 lo exige, y sin el
 * `login` y `password/forgot` quedan abiertos a fuerza bruta. Los UMBRALES
 * estan 🟡 en `configuration-registry.md` §3, pero el umbral es una decision de
 * negocio y el mecanismo es un control de seguridad: se implementa el mecanismo
 * con defaults operables por entorno —el mismo patron que
 * `AUTH_SESSION_TTL_HOURS`— y los valores quedan pendientes de confirmacion.
 *
 * ALGORITMO: ventana fija con INCR + EXPIRE en Redis. Es lo mas simple que
 * cumple (DEC-032). Su limitacion conocida es el pico en el borde de la
 * ventana: se pueden gastar `limit` intentos al final de una ventana y otros
 * `limit` al principio de la siguiente. Para frenar fuerza bruta alcanza; si
 * hiciera falta precision, se cambia a ventana deslizante sin tocar a los
 * llamadores.
 *
 * DOS DIMENSIONES, y no son simetricas:
 *
 *   por IP       se consume en CADA intento. Frena al atacante que prueba
 *                muchas cuentas desde un mismo origen.
 *   por cuenta   se consume SOLO ante un intento FALLIDO. Si se consumiera
 *                siempre, cualquiera podria dejar afuera a un usuario legitimo
 *                mandando intentos con su email: el control antifraude se
 *                convertiria en una herramienta de DoS contra la victima.
 */

/** Cliente minimo que necesita el limitador. Inyectable para poder testearlo. */
export interface RateLimitStore {
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<unknown>;
  ttl(key: string): Promise<number>;
  get(key: string): Promise<string | null>;
}

export interface RateLimitDecision {
  allowed: boolean;
  /** Segundos hasta que la ventana se libere. Alimenta el header `Retry-After`. */
  retryAfterSeconds: number;
}

const ALLOWED: RateLimitDecision = { allowed: true, retryAfterSeconds: 0 };

/**
 * Identifica al que llama.
 *
 * ⚠️ `x-forwarded-for` lo puede falsificar el cliente si la app NO esta detras
 * de un proxy de confianza que lo reescriba. En Coolify (tech-stack.md §5) el
 * reverse proxy lo hace, pero exponer el puerto de Next directamente a internet
 * volveria falsificable el limite por IP. Queda como nota de despliegue.
 */
export function clientIp(request: Request): string {
  // Se comprueba explicitamente contra la cadena vacia: una cabecera presente
  // pero vacia no identifica a nadie y debe seguir de largo.
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  if (forwarded !== undefined && forwarded !== '') return forwarded;

  const realIp = request.headers.get('x-real-ip')?.trim();
  if (realIp !== undefined && realIp !== '') return realIp;

  return 'desconocida';
}

/**
 * Deriva la parte de la clave que identifica una cuenta.
 *
 * El email NO se escribe en claro en Redis: es un dato personal y Redis no es
 * el almacen de datos personales del sistema. Se guarda un HMAC con el mismo
 * pepper que los tokens, que sirve igual para contar.
 */
function accountKeyPart(email: string): string {
  const pepper = requireEnv(getEnv(), 'AUTH_SESSION_SECRET');
  return createHmac('sha256', pepper).update(email.trim().toLowerCase()).digest('hex').slice(0, 32);
}

/**
 * Incrementa el contador de una clave y decide si el intento pasa.
 *
 * FALLA ABIERTO: si Redis no responde, deja pasar y lo registra. Es una
 * decision deliberada — con Redis caido, fallar cerrado dejaria a TODOS los
 * usuarios sin poder iniciar sesion, que es un incidente peor que perder
 * temporalmente la proteccion contra fuerza bruta. El error queda logueado
 * para que se vea (CLAUDE.md §9: nada de fallos silenciosos).
 */
export async function consume(
  store: RateLimitStore,
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitDecision> {
  try {
    const count = await store.incr(key);

    // Primer intento de la ventana: recien ahi se le pone vencimiento. Si se
    // renovara en cada intento, la ventana nunca terminaria de cerrarse y un
    // bloqueo duraria para siempre.
    if (count === 1) await store.expire(key, windowSeconds);

    if (count <= limit) return ALLOWED;

    const ttl = await store.ttl(key);
    return { allowed: false, retryAfterSeconds: ttl > 0 ? ttl : windowSeconds };
  } catch (error) {
    console.error('[rate-limit] Redis no respondio, se deja pasar el intento:', error);
    return ALLOWED;
  }
}

interface Limits {
  windowSeconds: number;
  maxPerIp: number;
  maxPerAccount: number;
}

function limits(): Limits {
  const env = getEnv();
  return {
    windowSeconds: env.AUTH_RATE_LIMIT_WINDOW_MINUTES * 60,
    maxPerIp: env.AUTH_RATE_LIMIT_MAX_PER_IP,
    maxPerAccount: env.AUTH_RATE_LIMIT_MAX_PER_ACCOUNT,
  };
}

/**
 * Presupuesto de las operaciones AUTENTICADAS. Es OTRO, no el de auth.
 *
 * Los de arriba estan calibrados contra adivinar una password —deliberadamente
 * bajos, porque nadie escribe mal su clave veinte veces—. Reusarlos para
 * publicar o subir fotos frenaria a un vendedor que trabaja normal. Dos
 * amenazas distintas, dos numeros distintos.
 */
function actionLimits(): { windowSeconds: number; maxPerUser: number } {
  const env = getEnv();
  return {
    windowSeconds: env.ACTIONS_RATE_LIMIT_WINDOW_MINUTES * 60,
    maxPerUser: env.ACTIONS_RATE_LIMIT_MAX_PER_USER,
  };
}

/**
 * Alcance del limite: separa los contadores por endpoint.
 *
 * `mp-connect` y `mp-callback` son endpoints de vendedor, no de auth, pero
 * comparten el mecanismo y los umbrales operables: iniciar una vinculacion
 * escribe en Redis y el callback dispara una llamada a un tercero, asi que
 * ninguno de los dos puede quedar abierto a repeticion ilimitada
 * (mercadopago-oauth-spec.md §13).
 *
 * Del resto —publicar, editar, subir fotos, comprar, pagar, reembolsar— NO hay
 * uno solo: cada familia de operaciones cuenta aparte. Si compartieran
 * contador, editar veinte publicaciones dejaria sin poder comprar, que no tiene
 * nada que ver con lo otro.
 */
export type RateLimitScope =
  | 'login'
  | 'register'
  | 'password-forgot'
  | 'password-reset'
  | 'verify-resend'
  | 'mp-connect'
  | 'mp-callback'
  | 'mp-disconnect'
  | 'checkout'
  | 'refund'
  | 'order-create'
  | 'listing-create'
  | 'listing-image'
  | 'listing-update'
  | 'seller-create'
  | 'tax-identity'
  | 'system-config'
  /*
   * Familias del ciclo de la orden y del panel (2026-09-11). Cada una cuenta
   * aparte por el mismo motivo que publicar y editar: si despachar y cancelar
   * compartieran contador, un vendedor que despacha su lote del dia se quedaria
   * sin poder cancelar la orden que necesita cancelar.
   */
  | 'order-ship'
  | 'order-cancel'
  | 'order-confirm'
  | 'dispute-open'
  | 'dispute-respond'
  | 'dispute-resolve'
  | 'review-create'
  | 'review-reply'
  | 'favorite-toggle'
  | 'listing-promote'
  | 'listing-report'
  | 'question-ask'
  | 'question-answer'
  | 'address-write'
  | 'notification-read'
  | 'cart-write'
  | 'seller-profile'
  | 'seller-vacation'
  | 'admin-moderate'
  | 'admin-dispute'
  | 'admin-tier';

/**
 * Consume una unidad del limite POR IP para este scope.
 *
 * Se llama al principio del Controller, antes de tocar la base: el punto de un
 * rate limit es no gastar recursos en el intento numero mil.
 */
export async function consumeIpLimit(
  request: Request,
  scope: RateLimitScope,
  store: RateLimitStore = getRedisClient(),
): Promise<RateLimitDecision> {
  return consumeIpLimitFor(clientIp(request), scope, store);
}

/**
 * Igual que `consumeIpLimit`, pero recibe la IP ya resuelta.
 *
 * Existe porque una **Server Action no tiene `Request`**: lee las cabeceras con
 * `headers()` de `next/headers`. Son dos formas de averiguar la MISMA IP, y el
 * conteo tiene que caer en la MISMA clave de Redis —si no, un atacante bloqueado
 * por la API seguiria libre por la pantalla, y al reves—.
 *
 * `next/headers` no se importa aca a proposito: este modulo lo usan tambien los
 * Route Handlers, y esa dependencia solo tiene sentido del lado de las
 * acciones. El helper que la usa vive en `rate-limit-actions.ts`.
 */
export async function consumeIpLimitFor(
  ip: string,
  scope: RateLimitScope,
  store: RateLimitStore = getRedisClient(),
): Promise<RateLimitDecision> {
  const { windowSeconds, maxPerIp } = limits();
  return consume(store, `rl:${scope}:ip:${ip}`, maxPerIp, windowSeconds);
}

/**
 * Consume una unidad del limite POR USUARIO para este scope.
 *
 * =============================================================================
 * POR QUE LAS OPERACIONES AUTENTICADAS SE CUENTAN POR USUARIO Y NO POR IP
 * =============================================================================
 *
 * En auth la IP es lo UNICO que hay: quien intenta entrar todavia no es nadie.
 * Aca ya hay sesion verificada, y entonces la IP es la peor de las dos claves
 * disponibles:
 *
 *  1. **Castiga a quien no hizo nada.** Detras de un NAT —una oficina, un
 *     locutorio, la red movil de una operadora— muchisima gente comparte una
 *     sola IP. Contar por IP hace que la actividad de un desconocido consuma el
 *     cupo del resto, y el bloqueo cae sobre gente que no hizo nada.
 *  2. **No frena a quien si.** Una IP se rota gratis. El `user_id` no: para
 *     tener otro hay que registrar una cuenta y verificar un email real, y ese
 *     camino ya tiene su propio limite.
 *
 * ⚠️ ES EL MISMO CONTADOR PARA LA PANTALLA Y PARA LA API. La leccion del
 * limitador de auth fue justamente esa: si cada camino contara aparte, bloquear
 * uno no serviria de nada porque el otro seguiria abierto.
 *
 * ⚠️ NO ES UN CUPO DE NEGOCIO. "Cuantas publicaciones puede tener un vendedor"
 * es ⚙️ CONFIGURABLE y vive en el Config Store (CLAUDE.md §12); el throttling
 * por estado de riesgo es TS-042 y sus umbrales siguen 🟡. Esto es un techo de
 * seguridad: alto para una persona, bajo para un script.
 *
 * ⚠️ EL `userId` VA EN CLARO, a diferencia del email. No es lo mismo: el email
 * es un dato personal y por eso se guarda como HMAC; el `user_id` es un uuid
 * interno opaco que no identifica a nadie fuera del sistema.
 */
export async function consumeUserLimit(
  scope: RateLimitScope,
  userId: string,
  store: RateLimitStore = getRedisClient(),
): Promise<RateLimitDecision> {
  const { windowSeconds, maxPerUser } = actionLimits();
  return consume(store, `rl:${scope}:user:${userId}`, maxPerUser, windowSeconds);
}

/**
 * Comprueba el limite POR CUENTA **sin consumirlo**.
 *
 * Va antes de verificar la password: si la cuenta ya acumulo demasiados fallos,
 * el intento se rechaza sin verificar nada.
 */
export async function checkAccountLimit(
  email: string,
  store: RateLimitStore = getRedisClient(),
): Promise<RateLimitDecision> {
  const { windowSeconds, maxPerAccount } = limits();
  const key = `rl:login:account:${accountKeyPart(email)}`;

  try {
    // Lectura pura: NO incrementa. El cupo por cuenta lo consume unicamente
    // `registerFailedAttempt`, para que un login legitimo no acerque al usuario
    // a su propio bloqueo.
    const count = Number(await store.get(key)) || 0;
    if (count < maxPerAccount) return ALLOWED;

    const ttl = await store.ttl(key);
    return { allowed: false, retryAfterSeconds: ttl > 0 ? ttl : windowSeconds };
  } catch (error) {
    console.error('[rate-limit] Redis no respondio, se deja pasar el intento:', error);
    return ALLOWED;
  }
}

/**
 * Consume el limite POR CUENTA de un scope, contando TODOS los intentos.
 *
 * ⚠️ ES DISTINTO DE `checkAccountLimit`, y la diferencia importa. Aquel es una
 * lectura pura sobre la clave de login, donde solo cuentan los FALLOS: un login
 * legitimo no debe acercar a nadie a su propio bloqueo.
 *
 * Aca cuenta cada intento, tenga exito o no, porque el intento exitoso ES el
 * dano: cada uno manda un email real a una persona real. Sin este limite, el
 * reenvio de verificacion es una maquina de inundar la casilla de un tercero
 * —basta con repetir el POST desde IPs distintas para saltear el limite por
 * IP—, y ademas destruye la reputacion de envio ante el proveedor.
 *
 * La clave lleva el scope, asi que NO comparte contador con el login.
 */
export async function consumeAccountLimit(
  scope: RateLimitScope,
  email: string,
  store: RateLimitStore = getRedisClient(),
): Promise<RateLimitDecision> {
  const { windowSeconds, maxPerAccount } = limits();

  return consume(
    store,
    `rl:${scope}:account:${accountKeyPart(email)}`,
    maxPerAccount,
    windowSeconds,
  );
}

/**
 * Registra un intento de login FALLIDO contra la cuenta.
 *
 * Solo los fallos cuentan: un login exitoso no debe acercar al usuario a su
 * propio bloqueo.
 */
export async function registerFailedAttempt(
  email: string,
  store: RateLimitStore = getRedisClient(),
): Promise<void> {
  const { windowSeconds, maxPerAccount } = limits();
  await consume(store, `rl:login:account:${accountKeyPart(email)}`, maxPerAccount, windowSeconds);
}
