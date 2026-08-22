import { getEnv } from '@offside/config';
import { withTimeout } from '@offside/utils';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from './schema/index';

/** Plazo maximo del health check. Debe ser corto: lo consume un readiness probe. */
const HEALTHCHECK_TIMEOUT_MS = 3_000;

export type Database = PostgresJsDatabase<typeof schema>;

let connection: postgres.Sql | undefined;
let database: Database | undefined;

/**
 * Cliente Postgres crudo (postgres.js), como singleton del proceso.
 *
 * Un unico pool por proceso: en desarrollo Next.js recarga los modulos en cada
 * cambio, y crear un pool nuevo por recarga agota las conexiones del servidor.
 */
function getConnection(): postgres.Sql {
  if (connection) return connection;

  const env = getEnv();

  // Los NOTICE de PostgreSQL son ruido fuera de desarrollo.
  const silenciarNotices = env.APP_ENV !== 'development';

  connection = postgres(env.DATABASE_URL, {
    // El worker de BullMQ y la app web comparten la misma base; se mantiene
    // conservador hasta medir carga real.
    max: env.APP_ENV === 'production' ? 10 : 5,
    idle_timeout: 20,
    connect_timeout: 10,
    // Los importes son bigint en centavos (ERD §1). Sin esto, postgres.js
    // devolveria strings y se perderia el tipo.
    types: {
      bigint: postgres.BigInt,
    },
    ...(silenciarNotices ? { onnotice: () => undefined } : {}),
  });

  return connection;
}

/** Instancia de Drizzle compartida por el proceso. */
export function getDatabase(): Database {
  database ??= drizzle(getConnection(), {
    schema,
    logger: getEnv().APP_ENV === 'development',
  });

  return database;
}

/**
 * Cierra el pool. Solo para apagado ordenado (workers, tests de integracion).
 * La app web no necesita llamarlo.
 */
export async function closeDatabase(): Promise<void> {
  if (!connection) return;

  await connection.end({ timeout: 5 });
  connection = undefined;
  database = undefined;
}

/**
 * Verifica que la base responda. Pensado para el health check y para los tests
 * de integracion, no para logica de negocio.
 *
 * Acotado en el tiempo: nunca debe colgar a quien lo llama.
 */
export async function checkDatabaseConnection(): Promise<boolean> {
  try {
    await withTimeout(
      getConnection()`SELECT 1`,
      HEALTHCHECK_TIMEOUT_MS,
      `PostgreSQL no respondio en ${HEALTHCHECK_TIMEOUT_MS}ms`,
    );
    return true;
  } catch (error) {
    console.error(
      '[database] health check fallido:',
      error instanceof Error ? error.message : error,
    );
    return false;
  }
}
