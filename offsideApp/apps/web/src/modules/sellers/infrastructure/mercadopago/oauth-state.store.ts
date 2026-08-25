import { getRedisClient } from '@offside/jobs';

/**
 * Contexto efimero del flujo OAuth, en Redis (spec §6).
 *
 * POR QUE REDIS Y NO POSTGRESQL: el `state` y el `code_verifier` viven 10
 * minutos y se usan una sola vez. Persistirlos seria guardar credenciales de un
 * solo uso en el almacen permanente, y obligaria a limpiarlas despues.
 *
 * POR QUE UNA SOLA CLAVE CON TODO: si `state` y `code_verifier` fueran dos
 * claves separadas podrian desincronizarse —una expira y la otra no— y el flujo
 * quedaria en un estado imposible de interpretar.
 *
 * ⚠️ El `code_verifier` que se guarda aca NO sale nunca hacia el frontend, ni a
 * los logs, ni a `audit_log` (spec §5).
 */

/** El `authorization_code` de Mercado Pago vive 10 minutos: el contexto, igual. */
const TTL_SECONDS = 600;

const KEY_PREFIX = 'mp:oauth:state:';

const key = (state: string): string => `${KEY_PREFIX}${state}`;

/** Contexto asociado a un `state`. Vive del lado del servidor (spec §6). */
export interface OAuthStateContext {
  userId: string;
  sellerId: string;
  codeVerifier: string;
  createdAt: string;
}

/**
 * Cliente minimo que necesita el store. Inyectable para poder testearlo sin
 * Redis, igual que `RateLimitStore` en `lib/rate-limit.ts`.
 */
export interface OAuthStateStore {
  set(key: string, value: string, mode: 'EX', seconds: number, flag: 'NX'): Promise<'OK' | null>;
  getdel(key: string): Promise<string | null>;
}

/**
 * Guarda el contexto. `NX` garantiza que un `state` nunca se pise: si la clave
 * ya existiera —lo que con 256 bits de entropia no deberia pasar jamas— es
 * preferible fallar que sobrescribir el contexto de otro flujo.
 */
export async function saveState(
  state: string,
  context: OAuthStateContext,
  store: OAuthStateStore = getRedisClient(),
): Promise<boolean> {
  const result = await store.set(key(state), JSON.stringify(context), 'EX', TTL_SECONDS, 'NX');
  return result === 'OK';
}

/**
 * Recupera el contexto y lo BORRA en una sola operacion atomica.
 *
 * `GETDEL` es lo que hace que el `state` sea de un solo uso: un segundo intento
 * —un replay del callback, o el usuario recargando la pagina— no encuentra
 * nada. Con `GET` + `DEL` separados habria una ventana en la que dos callbacks
 * concurrentes leerian el mismo contexto (spec §6 y §15).
 *
 * Devuelve `null` si el `state` no existe, expiro o ya fue consumido: los tres
 * casos son indistinguibles a proposito.
 */
export async function consumeState(
  state: string,
  store: OAuthStateStore = getRedisClient(),
): Promise<OAuthStateContext | null> {
  const raw = await store.getdel(key(state));
  if (raw === null) return null;

  try {
    return JSON.parse(raw) as OAuthStateContext;
  } catch {
    // Un valor ilegible se trata como state invalido: ya fue borrado por
    // GETDEL, asi que no puede reintentarse. Nunca se loguea el contenido.
    console.error('[mercadopago] el contexto OAuth guardado no es JSON valido');
    return null;
  }
}
