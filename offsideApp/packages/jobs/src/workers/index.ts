import { Worker, type Job, type Processor, type WorkerOptions } from 'bullmq';

import { createRedisConnection } from '../connection';

/**
 * Registro de workers.
 *
 * =============================================================================
 * SIN WORKERS DE NEGOCIO TODAVIA.
 * =============================================================================
 *
 * `createWorker` es la unica via para registrar uno: centraliza la conexion
 * dedicada, el logging de errores y el apagado ordenado.
 */

const registry = new Set<Worker>();

/**
 * Registra un worker con la configuracion estandar del proyecto.
 *
 * IMPORTANTE: el `processor` debe ser IDEMPOTENTE. Los jobs se reintentan y,
 * en el caso de los webhooks, los eventos externos llegan duplicados y
 * desordenados (architecture.md §8, CLAUDE.md §11).
 */
export function createWorker<TData = unknown, TResult = unknown>(
  name: string,
  processor: Processor<TData, TResult>,
  options: Partial<WorkerOptions> = {},
): Worker<TData, TResult> {
  const worker = new Worker<TData, TResult>(name, processor, {
    // Conexion dedicada: los workers bloquean su conexion esperando jobs.
    connection: createRedisConnection(),
    concurrency: 5,
    ...options,
  });

  worker.on('failed', (job: Job<TData, TResult> | undefined, error: Error) => {
    console.error(`[worker:${name}] job ${job?.id ?? 'desconocido'} fallo:`, error.message);
  });

  worker.on('error', (error: Error) => {
    console.error(`[worker:${name}] error:`, error.message);
  });

  registry.add(worker);
  return worker;
}

/** Workers registrados en este proceso. */
export function getRegisteredWorkers(): readonly Worker[] {
  return [...registry];
}

/** Cierra todos los workers, esperando a que terminen los jobs en curso. */
export async function closeWorkers(): Promise<void> {
  await Promise.all([...registry].map((worker) => worker.close()));
  registry.clear();
}
