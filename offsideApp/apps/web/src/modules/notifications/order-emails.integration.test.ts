import { randomUUID } from 'node:crypto';

import { getDatabase, schema } from '@offside/database';
import { like } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type * as Jobs from '@offside/jobs';

import type * as EmailService from './services/email.service';
import type * as OrderEmails from './services/order-emails.service';
import type * as SuppressionService from './services/email-suppression.service';
import type { OrdenEmail } from './templates/order.templates';

/**
 * Emails transaccionales de orden: integracion contra Redis y PostgreSQL
 * REALES.
 *
 * Lo que hay que demostrar son propiedades de la COLA —que el job llega a
 * `notifications-send` con un id determinista, que el mismo evento dos veces
 * es UN job, que el worker registrado en `instrumentation.ts` lo entiende— y
 * de la SUPRESION contra la tabla real. Un doble de la cola diria que si a
 * todo sin probar nada.
 *
 * ⚠️ REDIS ES COMPARTIDO con el servidor de desarrollo y con otros tests.
 * Los ids de orden son UUIDs frescos, asi que los `jobId` no chocan con nada,
 * y cada job que se encola se borra al final. Nada de FLUSHALL.
 *
 * LIMPIEZA: las direcciones usan el sufijo `@oetest.offside`.
 */

const SUFIJO = '@oetest.offside';
const email = (n: string) => `${n}${SUFIJO}`;

let orderEmails: typeof OrderEmails;
let emailService: typeof EmailService;
let suppressionService: typeof SuppressionService;
let getQueue: typeof Jobs.getQueue;
let queueName: string;
let closeQueues: () => Promise<void>;
let closeRedis: () => Promise<void>;

/** Jobs que este archivo encolo, para borrarlos al final. */
const encolados = new Set<string>();

beforeAll(async () => {
  const { loadRootEnv, resetEnvCache } = await import('@offside/config');
  loadRootEnv(import.meta.dirname);
  resetEnvCache();

  orderEmails = await import('./services/order-emails.service');
  emailService = await import('./services/email.service');
  suppressionService = await import('./services/email-suppression.service');

  const jobs = await import('@offside/jobs');
  getQueue = jobs.getQueue;
  queueName = jobs.QUEUE_NAMES.NOTIFICATIONS_SEND;
  closeQueues = jobs.closeQueues;
  closeRedis = jobs.closeRedisConnections;

  await limpiar();
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await limpiar();

  const cola = getQueue(queueName);
  for (const id of encolados) {
    try {
      await (await cola.getJob(id))?.remove();
    } catch {
      // Un job que el worker del servidor de desarrollo tomo en este instante
      // esta bloqueado y no se puede borrar: se lo lleva `removeOnComplete`.
    }
  }

  await closeQueues();
  const { closeDatabase } = await import('@offside/database');
  await closeDatabase();
  await closeRedis();
});

async function limpiar(): Promise<void> {
  await getDatabase()
    .delete(schema.emailSuppressions)
    .where(like(schema.emailSuppressions.email, `%${SUFIJO}`));
}

function orden(): OrdenEmail {
  return {
    id: randomUUID(),
    numero: `OE-${randomUUID().slice(0, 8)}`,
    total: '1000000',
    moneda: 'ARS',
    articulos: [{ titulo: 'Camiseta de prueba', cantidad: 1 }],
    importeVendedor: '940000',
  };
}

/** Notificacion de rebote duro, con la forma que manda SES. */
function reboteDuro(direccion: string) {
  return {
    notificationType: 'Bounce',
    mail: { messageId: 'mensaje-de-prueba' },
    bounce: {
      bounceType: 'Permanent',
      bounceSubType: 'General',
      bouncedRecipients: [{ emailAddress: direccion }],
    },
  };
}

function recordar(id: string | null): string {
  expect(id).not.toBeNull();
  encolados.add(id!);

  return id!;
}

describe('encolado en `notifications-send`', () => {
  it('encola en la cola real, con id determinista y los reintentos estandar', async () => {
    const o = orden();

    const id = recordar(
      await orderEmails.compraConfirmada({ email: email('ana'), nombre: 'Ana' }, o),
    );

    expect(id).toBe(`order_purchase_confirmed-${o.id}`);

    const job = await getQueue<OrderEmails.OrderEmailJobData>(queueName).getJob(id);

    expect(job).toBeDefined();
    expect(job?.name).toBe('order_purchase_confirmed');
    expect(job?.data).toMatchObject({
      kind: 'order_purchase_confirmed',
      to: email('ana'),
      nombre: 'Ana',
      orden: { id: o.id, numero: o.numero },
    });
    expect(job?.opts.attempts).toBe(5);
  });

  it('⚠️ el mismo evento dos veces es UN solo job: el segundo no pisa al primero', async () => {
    // Un webhook de Mercado Pago que llega dos veces no puede mandar dos
    // "vendiste". BullMQ, ante un `jobId` existente, devuelve el que estaba.
    const o = orden();
    const vendedor = { email: email('vendedor-repetido'), nombre: 'Primera' };

    const primero = recordar(await orderEmails.nuevaVenta(vendedor, o));
    const segundo = await orderEmails.nuevaVenta({ ...vendedor, nombre: 'Segunda' }, o);

    expect(segundo).toBe(primero);

    const job = await getQueue<OrderEmails.OrderEmailJobData>(queueName).getJob(primero);
    expect(job?.data.nombre).toBe('Primera');
  });

  it('reclamoResuelto encola dos jobs independientes, uno por parte', async () => {
    const o = orden();
    const disputa = {
      id: randomUUID(),
      ordenId: o.id,
      ordenNumero: o.numero,
      motivo: 'not_received',
      respuestaHasta: null,
      resolucion: 'full_refund',
      importeReembolsado: '1000000',
      moneda: 'ARS',
    };

    const ids = await orderEmails.reclamoResuelto(
      { email: email('comprador-disputa') },
      { email: email('vendedor-disputa') },
      disputa,
    );

    const comprador = recordar(ids.comprador);
    const vendedor = recordar(ids.vendedor);

    expect(comprador).not.toBe(vendedor);
    const cola = getQueue<OrderEmails.OrderEmailJobData>(queueName);
    expect((await cola.getJob(comprador))?.data).toMatchObject({ parte: 'comprador' });
    expect((await cola.getJob(vendedor))?.data).toMatchObject({ parte: 'vendedor' });
  });

  it('⚠️ una direccion suprimida NO encola, y no lanza', async () => {
    const direccion = email('rebota');
    await suppressionService.processFeedback(reboteDuro(direccion));
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const o = orden();
    const id = await orderEmails.nuevaVenta({ email: direccion }, o);

    expect(id).toBeNull();
    expect(aviso).toHaveBeenCalledWith(expect.stringContaining('NO encolado'));

    const job = await getQueue(queueName).getJob(`order_new_sale-${o.id}`);
    expect(job).toBeUndefined();
  });

  it('la supresion compara sin distinguir mayusculas, igual que `users.email`', async () => {
    const direccion = email('MayUsculas');
    await suppressionService.processFeedback(reboteDuro(direccion.toLowerCase()));
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    expect(
      await orderEmails.compraConfirmada({ email: direccion.toUpperCase() }, orden()),
    ).toBeNull();
  });
});

describe('procesamiento (lo que corre el worker)', () => {
  const payload = (
    to: string,
  ): Extract<OrderEmails.OrderEmailJobData, { kind: 'order_new_sale' }> => ({
    kind: 'order_new_sale',
    to,
    nombre: 'Ana',
    orden: orden(),
  });

  it('manda con el adaptador de log: el log es la casilla en desarrollo', async () => {
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const datos = payload(email('recibe'));

    await orderEmails.processOrderEmailJob(datos);

    const salida = aviso.mock.calls.flat().join('\n');
    expect(salida).toContain(`Para:    ${email('recibe')}`);
    expect(salida).toContain(`Asunto:  Vendiste: orden ${datos.orden.numero} — Offside Store`);
    expect(salida).toContain('email "order_new_sale" enviado a');
    expect(salida).toContain('via log');
  });

  it('⚠️ el procesador que registra `instrumentation.ts` deriva estos jobs', async () => {
    // Hay UN worker para `notifications-send` y corre `processEmailJob`. Si
    // no derivara por `kind`, los jobs de negocio se encolarian y fallarian
    // cinco veces cada uno.
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const datos = payload(email('via-worker'));

    await emailService.processEmailJob(datos);

    const salida = aviso.mock.calls.flat().join('\n');
    expect(salida).toContain(`Asunto:  Vendiste: orden ${datos.orden.numero}`);
    expect(salida).toContain('via log');
  });

  it('⚠️ NO manda a una direccion suprimida, aunque el job ya estuviera encolado', async () => {
    // Es la puerta que MANDA: un job encolado antes del rebote se frena aca.
    const direccion = email('suprimida-al-procesar');
    await suppressionService.processFeedback(reboteDuro(direccion));
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(orderEmails.processOrderEmailJob(payload(direccion))).resolves.toBeUndefined();

    const salida = aviso.mock.calls.flat().join('\n');
    expect(salida).toContain('NO enviado');
    expect(salida).not.toContain('Asunto:');
  });

  it('un payload invalido se descarta sin lanzar: reintentarlo no lo arreglaria', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(
      orderEmails.processOrderEmailJob({
        kind: 'order_new_sale',
        to: email('roto'),
        nombre: null,
        orden: { id: '', numero: '', total: 'no-son-centavos', moneda: 'ARS', articulos: [] },
      }),
    ).resolves.toBeUndefined();

    expect(error).toHaveBeenCalledWith(expect.stringContaining('descartado'));
    expect(aviso).not.toHaveBeenCalledWith(expect.stringContaining('Asunto:'));
  });

  it('el log dice QUE se mando y a quien, nunca el cuerpo', async () => {
    // El log de "enviado" no puede llevar titulos, comentarios ni importes de
    // otras personas. (El adaptador de log imprime el cuerpo aparte, a
    // proposito y solo fuera de produccion.)
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const datos: OrderEmails.OrderEmailJobData = {
      kind: 'review_received',
      to: email('resena'),
      nombre: null,
      resena: { ordenNumero: 'OE-X', puntaje: 5, comentario: 'COMENTARIO-PRIVADO' },
    };

    await orderEmails.processOrderEmailJob(datos);

    const lineaDeEnvio = aviso.mock.calls
      .flat()
      .map(String)
      .find((l) => l.includes('enviado a'));
    expect(lineaDeEnvio).toBeDefined();
    expect(lineaDeEnvio).not.toContain('COMENTARIO-PRIVADO');
  });
});
