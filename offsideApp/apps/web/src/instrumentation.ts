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
  await registrarBarridosDeOrdenes();
  await registrarBarridoDeDisputas();
  await registrarEfectosDeOrden();

  console.warn('[instrumentation] workers registrados');
}

/**
 * CABLEADO DE LOS EFECTOS DE UNA ORDEN.
 *
 * `orders` anuncia cada transicion (`order-events.ts`) y no sabe quien
 * escucha; acá se dice quien escucha. Es el unico lugar del codigo donde los
 * modulos de aviso y de confianza se conectan con el del ciclo de vida, y por
 * eso el orden esta escrito: primero los HECHOS y la reputacion, despues los
 * avisos —si un email falla, la reputacion ya quedo escrita—.
 *
 * ⚠️ LOS DOS REGISTROS SON IDEMPOTENTES. `register()` corre una vez por
 * instancia, pero en desarrollo Next recarga modulos y un registro duplicado
 * mandaria cada email dos veces.
 *
 * ⚠️ NO SE IMPORTAN ARRIBA. Los `import()` dinamicos mantienen el grafo de
 * arranque chico y evitan que un modulo de dominio entre al bundle del runtime
 * edge, donde no hay TCP.
 */
async function registrarEfectosDeOrden(): Promise<void> {
  const { registerReputationListeners } =
    await import('./modules/reputation/services/order-listener');
  const { registerOrderNotifications } =
    await import('./modules/notifications/services/order-notifier');

  registerReputationListeners();
  registerOrderNotifications();
}

/**
 * Barrido de reclamos sin respuesta del vendedor (TS-053).
 *
 * Cada hora: el plazo se mide en dias y escalar un rato mas tarde no le cambia
 * nada a nadie. Al cuarto y veinte para no salir junto con los otros dos.
 */
async function registrarBarridoDeDisputas(): Promise<void> {
  const { QUEUE_NAMES, createWorker, getQueue } = await import('@offside/jobs');
  const { escalateExpired } = await import('./modules/disputes/services/dispute.service');

  createWorker(QUEUE_NAMES.DISPUTES_ESCALATE_EXPIRED, async () => {
    await escalateExpired();
  });

  try {
    await getQueue(QUEUE_NAMES.DISPUTES_ESCALATE_EXPIRED).upsertJobScheduler(
      'disputes-escalate-expired-cada-hora',
      { pattern: '20 * * * *' },
      { name: 'barrido', data: {} },
    );
  } catch (error) {
    console.error(
      '[instrumentation] no se pudo programar la escalada de reclamos:',
      error instanceof Error ? error.message : String(error),
    );
  }
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

/**
 * Barridos del ciclo de la orden (DEC-029): vencimiento de la ventana de
 * pago (DEC-033) y cierre por proteccion vencida (BR-033 / MF-040).
 * Procesadores en `modules/orders/services/order-jobs.service.ts`.
 *
 * Mismo esquema que el refresh: `upsertJobScheduler` idempotente por id y
 * lock en Redis dentro del procesador, asi que dos instancias no se pisan.
 *
 * Frecuencias ASUMIDAS (no son configuracion de negocio, son de operacion):
 *  - vencimiento de pago cada 5 minutos: la ventana se mide en horas, y un
 *    retraso de minutos en cancelar no cambia nada para nadie;
 *  - cierre por proteccion cada hora: la ventana se mide en dias.
 */
async function registrarBarridosDeOrdenes(): Promise<void> {
  const { QUEUE_NAMES, createWorker, getQueue } = await import('@offside/jobs');
  const { expirePendingPayments, completeDeliveredOrders } =
    await import('./modules/orders/services/order-jobs.service');

  createWorker(QUEUE_NAMES.ORDERS_EXPIRE_PENDING_PAYMENT, async () => {
    await expirePendingPayments();
  });
  createWorker(QUEUE_NAMES.ORDERS_COMPLETE_DELIVERED, async () => {
    await completeDeliveredOrders();
  });

  const programar = async (cola: string, id: string, pattern: string): Promise<void> => {
    try {
      await getQueue(cola).upsertJobScheduler(id, { pattern }, { name: 'barrido', data: {} });
    } catch (error) {
      // Igual que el refresh: que no se pueda programar no tumba la app. Una
      // orden vencida que sigue abierta un rato mas no le cobra nada a nadie.
      console.error(
        `[instrumentation] no se pudo programar ${id}:`,
        error instanceof Error ? error.message : String(error),
      );
    }
  };

  await programar(
    QUEUE_NAMES.ORDERS_EXPIRE_PENDING_PAYMENT,
    'orders-expire-pending-payment-cada-5-min',
    '*/5 * * * *',
  );
  await programar(
    QUEUE_NAMES.ORDERS_COMPLETE_DELIVERED,
    'orders-complete-delivered-cada-hora',
    '15 * * * *',
  );
}
