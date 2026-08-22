/**
 * Punto de entrada del proceso worker.
 *
 *   npm run worker --workspace @offside/jobs
 *
 * Hoy no registra ningun worker: la infraestructura esta lista pero no hay jobs
 * de negocio. Arranca, queda a la espera y apaga de forma ordenada.
 *
 * Segun tech-stack.md §5 el worker puede correr en el mismo proceso que la web
 * al principio y separarse despues (futuro `apps/worker`). Por eso vive en un
 * package y no dentro de `apps/web`.
 */
import { getEnv, loadRootEnv } from '@offside/config';

loadRootEnv(import.meta.dirname);

import { closeRedisConnections } from '../connection';
import { closeQueues } from '../queues/index';
import { closeWorkers, getRegisteredWorkers } from './index';

function registerWorkers(): void {
  // Aca se registran los workers a medida que se implementen sus modulos:
  //
  //   createWorker(QUEUE_NAMES.PAYMENTS_WEBHOOKS, processPaymentWebhook);
  //   createWorker(QUEUE_NAMES.NOTIFICATIONS_SEND, sendNotification);
}

async function shutdown(signal: string): Promise<void> {
  console.warn(`[worker] ${signal} recibido, apagando...`);

  try {
    await closeWorkers();
    await closeQueues();
    await closeRedisConnections();
    console.warn('[worker] apagado ordenado completo');
    process.exit(0);
  } catch (error) {
    console.error('[worker] error durante el apagado:', error);
    process.exit(1);
  }
}

function main(): void {
  const env = getEnv();

  registerWorkers();

  console.warn(
    `[worker] iniciado en modo ${env.APP_ENV} — ${getRegisteredWorkers().length} worker(s) registrado(s)`,
  );

  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, () => {
      void shutdown(signal);
    });
  }
}

main();
