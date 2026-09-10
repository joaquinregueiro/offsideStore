import { withTimeout } from '@offside/utils';
import { getEnv } from '@offside/config';
import { Redis, type RedisOptions } from 'ioredis';

/**
 * Conexiones Redis del proceso.
 *
 * BullMQ v6 trae `ioredis` como peer dependency opcional; se instancia aca para
 * controlar las opciones y compartir un unico cliente.
 *
 * Hay DOS perfiles de conexion y NO son intercambiables. Mezclarlos cuelga el
 * proceso: ver el comentario de `blockingOptions`.
 */

/**
 * Perfil BLOQUEANTE — exclusivo de Workers y QueueEvents de BullMQ.
 *
 * `maxRetriesPerRequest: null` es OBLIGATORIO ahi: BullMQ usa comandos
 * bloqueantes (BRPOPLPUSH) y con el default de ioredis los aborta, matando al
 * worker.
 *
 * ⚠️ NO usar este perfil para comandos normales. Con `maxRetriesPerRequest:
 * null` ioredis **encola los comandos indefinidamente** cuando Redis no
 * responde, en vez de rechazarlos: un simple `ping()` no vuelve nunca.
 */
const blockingOptions: RedisOptions = {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
};

/**
 * Perfil COMPARTIDO — encolar jobs, cache y health checks.
 *
 * Reintentos acotados para que un Redis caido produzca un error y no una espera
 * infinita.
 */
const sharedOptions: RedisOptions = {
  // Acotado: con Redis caido el comando termina rechazando en vez de esperar
  // para siempre. Es lo contrario de `blockingOptions`.
  maxRetriesPerRequest: 3,
  connectTimeout: 5_000,
  // `enableOfflineQueue` queda en su default (true) A PROPOSITO: ioredis conecta
  // de forma asincrona, y con la cola desactivada el PRIMER comando falla
  // siempre —incluso con Redis sano— porque el socket todavia no esta listo.
  // El limite de espera lo pone `withTimeout`, no esta opcion.
};

/** Plazo maximo del health check. Debe ser corto: lo consume un readiness probe. */
const HEALTHCHECK_TIMEOUT_MS = 3_000;

let sharedClient: Redis | undefined;
const clients = new Set<Redis>();

function create(options: RedisOptions = {}): Redis {
  const client = new Redis(getEnv().REDIS_URL, options);

  client.on('error', (error: Error) => {
    // Nunca silenciar: si Redis se cae, las colas dejan de procesar
    // (CLAUDE.md §9 — manejo explicito de errores).
    console.error('[redis] error de conexion:', error.message);
  });

  clients.add(client);
  return client;
}

/**
 * Cliente compartido para operaciones NO bloqueantes: encolar jobs, cache.
 * Las Queues pueden reutilizarlo sin problema.
 */
export function getRedisClient(): Redis {
  sharedClient ??= create(sharedOptions);
  return sharedClient;
}

/**
 * Crea una conexion DEDICADA. Cada Worker y cada QueueEvents necesita la suya
 * porque bloquea la conexion mientras espera jobs.
 */
export function createRedisConnection(): Redis {
  return create(blockingOptions);
}

/**
 * Comprueba que Redis responda. Para health checks y tests de integracion.
 *
 * Acotado en el tiempo: nunca debe colgar a quien lo llama, pase lo que pase
 * con la conexion.
 */
export async function checkRedisConnection(): Promise<boolean> {
  try {
    const pong = await withTimeout(
      getRedisClient().ping(),
      HEALTHCHECK_TIMEOUT_MS,
      `Redis no respondio en ${HEALTHCHECK_TIMEOUT_MS}ms`,
    );

    return pong === 'PONG';
  } catch (error) {
    console.error('[redis] health check fallido:', error instanceof Error ? error.message : error);
    return false;
  }
}

/** Cierra todas las conexiones abiertas. Para apagado ordenado. */
export async function closeRedisConnections(): Promise<void> {
  await Promise.all([...clients].map((client) => client.quit().catch(() => client.disconnect())));

  clients.clear();
  sharedClient = undefined;
}
