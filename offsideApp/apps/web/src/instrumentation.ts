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

  await registrarRefreshDeTokens();

  console.warn('[instrumentation] workers registrados');
}

/**
 * Barrido diario de renovacion de tokens de Mercado Pago (spec §10).
 *
 * ⚠️ SE USA `upsertJobScheduler`, NO `add({ repeat })`. BullMQ 6 reemplazo la
 * segunda por la primera. El upsert es idempotente por su id: aunque el proceso
 * arranque muchas veces —cada deploy, cada reinicio— queda UNA programacion.
 * Con la API vieja, cada arranque agregaba otra repeticion y el barrido corria
 * N veces por dia.
 *
 * Corre de madrugada: la ventana de renovacion es de dias, asi que no hay
 * urgencia, y conviene no competir con el trafico de compra.
 */
async function registrarRefreshDeTokens(): Promise<void> {
  const { QUEUE_NAMES, createWorker, getQueue } = await import('@offside/jobs');
  const { refreshExpiring } =
    await import('./modules/sellers/services/mercadopago-refresh.service');

  createWorker(QUEUE_NAMES.MERCADOPAGO_TOKEN_REFRESH, async () => {
    await refreshExpiring();
  });

  try {
    await getQueue(QUEUE_NAMES.MERCADOPAGO_TOKEN_REFRESH).upsertJobScheduler(
      'mercadopago-token-refresh-diario',
      { pattern: '0 4 * * *' },
      { name: 'barrido-diario', data: {} },
    );
  } catch (error) {
    // Que no se pueda programar el barrido NO puede impedir que la aplicacion
    // levante: sin el, los tokens siguen sirviendo por meses. Se registra y se
    // sigue.
    console.error(
      '[instrumentation] no se pudo programar el refresh de tokens:',
      error instanceof Error ? error.message : String(error),
    );
  }
}
