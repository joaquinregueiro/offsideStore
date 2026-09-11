import { getRedisClient } from './connection';

/**
 * Lock distribuido para jobs periodicos: `SET NX EX` en Redis.
 *
 * ⚠️ EXISTE PORQUE EL PROCESO WEB PUEDE CORRER MAS DE UNA VEZ. Coolify puede
 * levantar dos instancias durante un deploy, y `upsertJobScheduler` programa
 * UNA repeticion pero el job lo toma el primer worker libre: si dos barridos
 * del mismo tipo corrieran a la vez sobre las mismas ordenes, uno cancelaria
 * lo que el otro ya cancelo. El `WHERE status = ...` de cada transicion es la
 * ultima defensa contra eso; el lock evita llegar ahi.
 *
 * Mismo mecanismo que `mp:refresh:lock:` en `sellers`, generalizado: cada
 * usuario elige su PREFIJO para que dos jobs distintos no compartan clave.
 * Redis es compartido entre entornos de test, asi que el prefijo importa.
 *
 * El valor guardado es un token aleatorio y `release` lo compara antes de
 * borrar: si el lock vencio por TTL y otro proceso lo tomo, el primero no le
 * borra el suyo.
 */

/** Lo minimo que este modulo necesita de un cliente Redis. Para tests. */
export interface LockStore {
  set(key: string, value: string, mode: 'EX', seconds: number, flag: 'NX'): Promise<'OK' | null>;
  get(key: string): Promise<string | null>;
  del(key: string): Promise<number>;
}

export interface AcquiredLock {
  key: string;
  token: string;
}

/** `null` si otro proceso ya lo tiene. */
export async function acquireLock(
  key: string,
  ttlSeconds: number,
  store: LockStore = getRedisClient(),
): Promise<AcquiredLock | null> {
  if (!Number.isInteger(ttlSeconds) || ttlSeconds <= 0) {
    throw new Error(`ttlSeconds debe ser un entero positivo (recibido: ${ttlSeconds})`);
  }

  const token = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const result = await store.set(key, token, 'EX', ttlSeconds, 'NX');

  return result === 'OK' ? { key, token } : null;
}

/**
 * Libera el lock SOLO si sigue siendo nuestro.
 *
 * No es atomico (GET + DEL) y no hace falta que lo sea: el caso que protege
 * es que el TTL haya vencido y otro proceso tenga el lock; una carrera en la
 * ventana entre el GET y el DEL exige que el TTL venza justo ahi, y los TTL
 * de los barridos son de minutos.
 */
export async function releaseLock(
  lock: AcquiredLock,
  store: LockStore = getRedisClient(),
): Promise<void> {
  const actual = await store.get(lock.key);
  if (actual === lock.token) await store.del(lock.key);
}

export type WithLockResult<T> = { acquired: true; result: T } | { acquired: false };

/**
 * Corre `fn` con el lock tomado, o devuelve `{ acquired: false }` sin correrla.
 *
 * El lock se libera SIEMPRE en `finally`: un barrido que falla no puede dejar
 * bloqueado al siguiente hasta que venza el TTL.
 */
export async function withLock<T>(
  key: string,
  ttlSeconds: number,
  fn: () => Promise<T>,
  store: LockStore = getRedisClient(),
): Promise<WithLockResult<T>> {
  const lock = await acquireLock(key, ttlSeconds, store);
  if (lock === null) return { acquired: false };

  try {
    return { acquired: true, result: await fn() };
  } finally {
    await releaseLock(lock, store);
  }
}
