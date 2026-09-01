import { getRedisClient } from '@offside/jobs';

/**
 * Lock por vendedor para la renovacion de tokens (spec §10).
 *
 * ⚠️ ES OBLIGATORIO, NO UNA OPTIMIZACION. Mercado Pago **rota** el
 * `refresh_token` en cada renovacion: dos refresh simultaneos del mismo
 * vendedor obtendrian dos tokens nuevos y el segundo pisaria al primero,
 * dejando guardado un token que Mercado Pago ya considera reemplazado. La
 * conexion quedaria sin forma de renovarse.
 *
 * Mismo mecanismo que `oauth-state.store.ts`: `SET NX EX` en Redis.
 */

const PREFIJO = 'mp:refresh:lock:';

/**
 * TTL del lock.
 *
 * Tiene que superar largamente lo que tarda un refresh —una request HTTP mas
 * un UPDATE— pero no tanto como para dejar bloqueado a un vendedor si el
 * proceso muere sin liberar. Con 60 s, un worker caido se destraba solo antes
 * del proximo barrido.
 */
const TTL_SECONDS = 60;

export interface RefreshLockStore {
  set(key: string, value: string, mode: 'EX', seconds: number, flag: 'NX'): Promise<'OK' | null>;
  del(key: string): Promise<number>;
}

const key = (sellerId: string): string => `${PREFIJO}${sellerId}`;

/** `true` si se obtuvo el lock. `false` si otro proceso ya lo tiene. */
export async function acquire(
  sellerId: string,
  store: RefreshLockStore = getRedisClient(),
): Promise<boolean> {
  const result = await store.set(key(sellerId), '1', 'EX', TTL_SECONDS, 'NX');

  return result === 'OK';
}

/**
 * Libera el lock.
 *
 * ⚠️ Se llama SIEMPRE en un `finally`: si un refresh falla y no se libera, ese
 * vendedor queda sin poder renovarse hasta que expire el TTL.
 */
export async function release(
  sellerId: string,
  store: RefreshLockStore = getRedisClient(),
): Promise<void> {
  await store.del(key(sellerId));
}
