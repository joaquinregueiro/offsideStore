/**
 * Arranque del servidor de Next. `register()` corre UNA vez por instancia,
 * antes de atender el primer request.
 *
 * POR QUE EL WORKER CORRE ACA: `tech-stack.md` §5 habilita explicitamente que
 * el worker viva "en el mismo proceso que la web al principio y se separe
 * despues (futuro `apps/worker`)". Registrarlo desde `apps/web` ademas resuelve
 * un problema de dependencias: el procesador de emails vive en
 * `modules/notifications`, y `packages/jobs` no puede importar de `apps/web`
 * sin invertir la direccion del monorepo.
 *
 * El dia que el envio justifique su propio contenedor, se mueve el registro a
 * `packages/jobs/src/workers/main.ts` —que ya existe y ya sabe apagarse
 * ordenadamente— y se corre `npm run worker:start` como segundo servicio. Nada
 * mas cambia.
 */
import type { EmailJobData } from './modules/notifications/services/email.service';

export async function register(): Promise<void> {
  // `register()` tambien corre en el runtime edge, donde no hay TCP y BullMQ no
  // funciona. Sin esta guarda, el build de Next intenta empaquetar ioredis para
  // edge y falla.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const { QUEUE_NAMES, createWorker } = await import('@offside/jobs');
  const { processEmailJob } = await import('./modules/notifications/services/email.service');

  createWorker<EmailJobData>(QUEUE_NAMES.NOTIFICATIONS_SEND, async (job) => {
    await processEmailJob(job.data);
  });

  console.warn('[instrumentation] worker de notificaciones registrado');
}
