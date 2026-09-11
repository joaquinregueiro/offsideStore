import { createHash } from 'node:crypto';

import { QUEUE_NAMES, defaultJobOptions, getQueue } from '@offside/jobs';
import { z } from 'zod';

import { createEmailSender, type EmailMessage } from '../infrastructure/email/index';
import * as templates from '../templates/order.templates';
import type {
  DisputaEmail,
  NivelVendedorEmail,
  OrdenEmail,
  ParteDeLaOrden,
  ResenaEmail,
  SeguimientoEmail,
} from '../templates/order.templates';
import { isSuppressed } from './email-suppression.service';

/**
 * Emails transaccionales de compra, venta, despacho, entrega, reclamo,
 * calificacion y nivel de vendedor (`notifications-and-engagement.md` §2.1).
 *
 * MISMA FORMA QUE `email.service.ts`, a proposito: una funcion por evento que
 * ENCOLA en `notifications-send` y un procesador que corre en el worker. Lo
 * que cambia es el payload —datos de negocio en vez de un token— y por eso
 * vive en un archivo aparte: el de `auth` maneja credenciales de un solo uso y
 * conviene que siga siendo chico y auditable por si solo.
 *
 * ⚠️ ESTE SERVICE NO LEE LA BASE. Recibe snapshots planos y los manda tal
 * cual. Quien llama (orders, shipments, disputes, reviews, sellers) ya tiene
 * la fila en la mano y sabe que direccion corresponde; consultar acá de nuevo
 * seria una segunda fuente de verdad para lo mismo. Ademas el payload viaja
 * como JSON por Redis: nada de `Date` ni de filas de Drizzle.
 *
 * ⚠️ SE ENCOLA DESPUES DE COMMITEAR, nunca dentro de la transaccion que cambia
 * el estado: encolar adentro mandaria "vendiste" de una orden que todavia
 * puede revertirse. Es responsabilidad del caller, igual que en `auth`.
 *
 * ⚠️ LA SUPRESION (`email_suppressions`) SE CONSULTA DOS VECES, y las dos
 * pasan por la misma `isSuppressed()`. La que MANDA es la del procesador, en
 * el ultimo punto antes del proveedor, exactamente como hace
 * `processEmailJob`: por ahi pasa TODO email que sale del sistema. La de
 * `enqueueOrderEmail` es un filtro previo: una direccion suprimida no genera
 * job —no ocupa Redis, no consume reintentos y no deja un `jobId` retenido
 * que impida reenviar el mismo evento si la direccion se libera despues—. No
 * reemplaza a la del procesador: un job encolado antes de la supresion se
 * frena igual alla.
 *
 * EL WORKER: `instrumentation.ts` registra `processEmailJob` (en
 * `email.service.ts`) sobre `notifications-send`, y ese procesador deriva en
 * `processOrderEmailJob` cuando `isOrderEmailJob(job.data)`. Un solo worker
 * para la cola; dos procesadores segun el `kind`.
 */

/* --------------------------------------------------------------- tipos */

export type OrderEmailKind =
  | 'order_new_sale'
  | 'order_purchase_confirmed'
  | 'order_shipped'
  | 'order_confirm_receipt'
  | 'order_sale_completed'
  | 'order_cancelled'
  | 'dispute_opened'
  | 'dispute_resolved'
  | 'review_received'
  | 'seller_tier_updated';

const KINDS: readonly OrderEmailKind[] = [
  'order_new_sale',
  'order_purchase_confirmed',
  'order_shipped',
  'order_confirm_receipt',
  'order_sale_completed',
  'order_cancelled',
  'dispute_opened',
  'dispute_resolved',
  'review_received',
  'seller_tier_updated',
];

/** A quien se le manda. `nombre` es `users.display_name` (puede no tener). */
export interface Destinatario {
  email: string;
  nombre?: string | null;
}

interface JobBase {
  to: string;
  nombre: string | null;
}

export type OrderEmailJobData =
  | ({ kind: 'order_new_sale'; orden: OrdenEmail } & JobBase)
  | ({ kind: 'order_purchase_confirmed'; orden: OrdenEmail } & JobBase)
  | ({ kind: 'order_shipped'; orden: OrdenEmail; seguimiento: SeguimientoEmail } & JobBase)
  | ({ kind: 'order_confirm_receipt'; orden: OrdenEmail; diasRestantes: number } & JobBase)
  | ({ kind: 'order_sale_completed'; orden: OrdenEmail } & JobBase)
  | ({
      kind: 'order_cancelled';
      orden: OrdenEmail;
      parte: ParteDeLaOrden;
      pagoAcreditado: boolean;
    } & JobBase)
  | ({ kind: 'dispute_opened'; disputa: DisputaEmail } & JobBase)
  | ({ kind: 'dispute_resolved'; disputa: DisputaEmail; parte: ParteDeLaOrden } & JobBase)
  | ({ kind: 'review_received'; resena: ResenaEmail } & JobBase)
  | ({ kind: 'seller_tier_updated'; nivel: NivelVendedorEmail } & JobBase);

/* ---------------------------------------------------- validacion del job */

/**
 * El job es un BORDE (CLAUDE.md §9): lo que llega del worker salio de Redis y
 * pudo encolarlo cualquier version del codigo. Se valida antes de construir
 * el email, no despues.
 */
const centavos = z.string().regex(/^\d+$/, 'centavos como string de digitos');
const moneda = z.string().length(3);

const ordenSchema = z.object({
  id: z.string().min(1),
  numero: z.string().min(1),
  total: centavos,
  moneda,
  articulos: z.array(z.object({ titulo: z.string(), cantidad: z.number().int().positive() })),
  importeVendedor: centavos.nullable().optional(),
});

const seguimientoSchema = z.object({
  numero: z.string().min(1),
  transportista: z.string().nullable(),
});

const disputaSchema = z.object({
  id: z.string().min(1),
  ordenId: z.string().min(1),
  ordenNumero: z.string().min(1),
  motivo: z.string().min(1),
  respuestaHasta: z.string().nullable(),
  resolucion: z.string().nullable(),
  importeReembolsado: centavos.nullable(),
  moneda,
});

const resenaSchema = z.object({
  ordenNumero: z.string().min(1),
  puntaje: z.number().int().min(1).max(5),
  comentario: z.string().nullable(),
});

const nivelSchema = z.object({
  codigo: z.string().min(1),
  nombre: z.string().min(1),
  comisionBasisPoints: z.number().int().nonnegative().nullable(),
});

const parte = z.enum(['comprador', 'vendedor']);

const base = { to: z.string().min(3), nombre: z.string().nullable() };

const jobSchema = z.discriminatedUnion('kind', [
  z.object({ ...base, kind: z.literal('order_new_sale'), orden: ordenSchema }),
  z.object({ ...base, kind: z.literal('order_purchase_confirmed'), orden: ordenSchema }),
  z.object({
    ...base,
    kind: z.literal('order_shipped'),
    orden: ordenSchema,
    seguimiento: seguimientoSchema,
  }),
  z.object({
    ...base,
    kind: z.literal('order_confirm_receipt'),
    orden: ordenSchema,
    diasRestantes: z.number().int().nonnegative(),
  }),
  z.object({ ...base, kind: z.literal('order_sale_completed'), orden: ordenSchema }),
  z.object({
    ...base,
    kind: z.literal('order_cancelled'),
    orden: ordenSchema,
    parte,
    pagoAcreditado: z.boolean(),
  }),
  z.object({ ...base, kind: z.literal('dispute_opened'), disputa: disputaSchema }),
  z.object({ ...base, kind: z.literal('dispute_resolved'), disputa: disputaSchema, parte }),
  z.object({ ...base, kind: z.literal('review_received'), resena: resenaSchema }),
  z.object({ ...base, kind: z.literal('seller_tier_updated'), nivel: nivelSchema }),
]);

/**
 * Distingue un job de este service de uno de `auth`. Es lo unico que necesita
 * `processEmailJob` para derivar; la validacion completa la hace el procesador.
 */
export function isOrderEmailJob(data: unknown): data is OrderEmailJobData {
  if (typeof data !== 'object' || data === null || !('kind' in data)) return false;
  const { kind } = data;

  return typeof kind === 'string' && (KINDS as readonly string[]).includes(kind);
}

/* ------------------------------------------------------------ procesador */

function build(data: OrderEmailJobData): EmailMessage {
  switch (data.kind) {
    case 'order_new_sale':
      return templates.nuevaVenta(data.to, data.nombre, data.orden);
    case 'order_purchase_confirmed':
      return templates.compraConfirmada(data.to, data.nombre, data.orden);
    case 'order_shipped':
      return templates.pedidoDespachado(data.to, data.nombre, data.orden, data.seguimiento);
    case 'order_confirm_receipt':
      return templates.confirmaRecepcion(data.to, data.nombre, data.orden, data.diasRestantes);
    case 'order_sale_completed':
      return templates.ventaCompletada(data.to, data.nombre, data.orden);
    case 'order_cancelled':
      return templates.ordenCancelada(
        data.to,
        data.nombre,
        data.orden,
        data.parte,
        data.pagoAcreditado,
      );
    case 'dispute_opened':
      return templates.reclamoAbierto(data.to, data.nombre, data.disputa);
    case 'dispute_resolved':
      return templates.reclamoResuelto(data.to, data.nombre, data.disputa, data.parte);
    case 'review_received':
      return templates.calificacionRecibida(data.to, data.nombre, data.resena);
    case 'seller_tier_updated':
      return templates.nivelDeVendedorActualizado(data.to, data.nombre, data.nivel);
  }
}

/**
 * Procesa un job de la cola. Lo ejecuta el worker, no el request.
 *
 * IDEMPOTENCIA: reintentar reenvia el email. Aceptable —molesta, no rompe— y
 * preferible a perder el aviso. Lo que SI se evita es encolar dos veces el
 * mismo evento: ver `jobIdDe`.
 */
export async function processOrderEmailJob(data: unknown): Promise<void> {
  const parsed = jobSchema.safeParse(data);

  if (!parsed.success) {
    // Un payload que no valida no va a validar en el quinto intento tampoco.
    // Se registra y se descarta; NO se lanza, para que BullMQ no reintente.
    const kind = isOrderEmailJob(data) ? data.kind : 'desconocido';
    console.error(`[notifications] job de email "${kind}" descartado: payload invalido`);

    return;
  }

  const job = parsed.data;

  // Mismo criterio y mismo punto que `processEmailJob`: la supresion se mira
  // en el ultimo lugar antes del proveedor, y no se lanza.
  if (await isSuppressed(job.to)) {
    console.warn(
      `[notifications] email "${job.kind}" NO enviado: ${job.to} esta suprimida ` +
        '(rebote duro o queja). La cuenta no va a recibir nada hasta que se libere.',
    );

    return;
  }

  const sender = createEmailSender();
  await sender.send(build(job));

  // QUE se mando y a quien. Nunca el cuerpo: lleva titulos, comentarios e
  // importes de otras personas.
  console.warn(`[notifications] email "${job.kind}" enviado a ${job.to} via ${sender.name}`);
}

/* --------------------------------------------------------------- encolado */

/**
 * Id determinista por evento y destinatario.
 *
 * ⚠️ ES LA PROTECCION CONTRA EL DOBLE ENVIO. Los disparadores de estos emails
 * son transiciones que se repiten con facilidad —un webhook de Mercado Pago
 * llega dos veces, un job de vencimiento corre en dos instancias—. BullMQ, ante
 * un `jobId` que ya existe (esperando, activo o retenido tras completarse),
 * NO agrega otro: devuelve el que estaba. Asi "vendiste" sale UNA vez por
 * orden aunque el caller lo pida dos.
 *
 * El costo: si el job agoto sus reintentos, mientras BullMQ lo retenga
 * (`removeOnFail`, 7 dias) no se puede volver a encolar el mismo evento. Es
 * el trade-off correcto para avisos: un email perdido se explica, uno
 * repetido diez veces por un webhook en bucle no.
 *
 * ⚠️ SIN `:`: BullMQ lo reserva para sus propias claves en Redis.
 */
export function jobIdDe(data: OrderEmailJobData): string {
  switch (data.kind) {
    case 'order_new_sale':
    case 'order_purchase_confirmed':
    case 'order_shipped':
    case 'order_sale_completed':
      return `${data.kind}-${data.orden.id}`;
    case 'order_confirm_receipt':
      // Un recordatorio por cada "cuantos dias faltan": el de 3 y el de 1
      // son avisos distintos.
      return `${data.kind}-${data.orden.id}-${data.diasRestantes}`;
    case 'order_cancelled':
      return `${data.kind}-${data.orden.id}-${data.parte}`;
    case 'dispute_opened':
      return `${data.kind}-${data.disputa.id}`;
    case 'dispute_resolved':
      return `${data.kind}-${data.disputa.id}-${data.parte}`;
    case 'review_received':
      return `${data.kind}-${data.resena.ordenNumero}`;
    case 'seller_tier_updated':
      // Un cambio de tier no tiene id propio: lo identifica el destinatario
      // y el tier destino. Se HASHEA la direccion porque el id termina como
      // clave en Redis —un dato personal a la vista de cualquier `KEYS *`— y
      // porque una direccion puede llevar `:`, que BullMQ reserva.
      return `${data.kind}-${huella(data.to)}-${data.nivel.codigo}`;
  }
}

/** Identificador corto y estable de una direccion, sin la direccion. */
function huella(email: string): string {
  return createHash('sha256').update(email.trim().toLowerCase()).digest('hex').slice(0, 16);
}

/**
 * Encola un email de negocio. NO espera a que se envie.
 *
 * ⚠️ NO LANZA. Si Redis no responde devuelve `null`, registra el error y el
 * flujo que llamo sigue: que la cola falle no puede deshacer una venta que ya
 * esta escrita. Devuelve el id del job para que el caller pueda dejarlo
 * anotado (en `audit_log`, en un log) y rastrearlo.
 */
export async function enqueueOrderEmail(data: OrderEmailJobData): Promise<string | null> {
  // Filtro previo (ver la nota de arriba). `isSuppressed` falla abierto: si la
  // consulta no responde, se encola y decide el procesador.
  if (await isSuppressed(data.to)) {
    console.warn(
      `[notifications] email "${data.kind}" NO encolado: ${data.to} esta suprimida ` +
        '(rebote duro o queja).',
    );

    return null;
  }

  try {
    const job = await getQueue<OrderEmailJobData>(QUEUE_NAMES.NOTIFICATIONS_SEND).add(
      data.kind,
      data,
      { ...defaultJobOptions, jobId: jobIdDe(data) },
    );

    return job.id ?? null;
  } catch (error) {
    console.error(
      `[notifications] no se pudo encolar el email "${data.kind}":`,
      error instanceof Error ? error.message : String(error),
    );

    return null;
  }
}

function destinatario(d: Destinatario): JobBase {
  return { to: d.email, nombre: d.nombre ?? null };
}

/* ------------------------------------------------ una funcion por evento */

/** Al vendedor. Disparador: la orden pasa a `PAID` (webhook aprobado, MF-030). */
export function nuevaVenta(seller: Destinatario, orden: OrdenEmail): Promise<string | null> {
  return enqueueOrderEmail({ kind: 'order_new_sale', ...destinatario(seller), orden });
}

/** Al comprador. Disparador: la orden pasa a `PAID`. */
export function compraConfirmada(buyer: Destinatario, orden: OrdenEmail): Promise<string | null> {
  return enqueueOrderEmail({ kind: 'order_purchase_confirmed', ...destinatario(buyer), orden });
}

/** Al comprador. Disparador: la orden pasa a `SHIPPED` (el vendedor carga el tracking). */
export function pedidoDespachado(
  buyer: Destinatario,
  orden: OrdenEmail,
  tracking: SeguimientoEmail,
): Promise<string | null> {
  return enqueueOrderEmail({
    kind: 'order_shipped',
    ...destinatario(buyer),
    orden,
    seguimiento: tracking,
  });
}

/**
 * Al comprador. Disparador: recordatorio programado mientras la orden esta en
 * `SHIPPED`/`DELIVERED` y falta `diasRestantes` para que venza
 * `buyer_protection_days`.
 */
export function confirmaRecepcion(
  buyer: Destinatario,
  orden: OrdenEmail,
  diasRestantes: number,
): Promise<string | null> {
  return enqueueOrderEmail({
    kind: 'order_confirm_receipt',
    ...destinatario(buyer),
    orden,
    diasRestantes: Math.max(0, Math.floor(diasRestantes)),
  });
}

/** Al vendedor. Disparador: la orden pasa a `COMPLETED`. */
export function ventaCompletada(seller: Destinatario, orden: OrdenEmail): Promise<string | null> {
  return enqueueOrderEmail({ kind: 'order_sale_completed', ...destinatario(seller), orden });
}

/**
 * A quien corresponda. Disparador: la orden pasa a `CANCELLED`. Se llama una
 * vez por parte que deba enterarse; `pagoAcreditado` sale del pago, no de la
 * orden (una cancelada desde `PENDING_PAYMENT` no tiene nada que devolver).
 */
export function ordenCancelada(
  destino: Destinatario,
  orden: OrdenEmail,
  opciones: { parte: ParteDeLaOrden; pagoAcreditado: boolean },
): Promise<string | null> {
  return enqueueOrderEmail({
    kind: 'order_cancelled',
    ...destinatario(destino),
    orden,
    parte: opciones.parte,
    pagoAcreditado: opciones.pagoAcreditado,
  });
}

/** Al vendedor. Disparador: la disputa se crea en `OPEN` (TS-050). */
export function reclamoAbierto(
  seller: Destinatario,
  disputa: DisputaEmail,
): Promise<string | null> {
  return enqueueOrderEmail({ kind: 'dispute_opened', ...destinatario(seller), disputa });
}

/**
 * A las dos partes. Disparador: la disputa pasa a `RESOLVED`. Son dos jobs
 * independientes: que uno no se pueda encolar no frena al otro.
 */
export async function reclamoResuelto(
  buyer: Destinatario,
  seller: Destinatario,
  disputa: DisputaEmail,
): Promise<{ comprador: string | null; vendedor: string | null }> {
  const [comprador, vendedor] = await Promise.all([
    enqueueOrderEmail({
      kind: 'dispute_resolved',
      ...destinatario(buyer),
      disputa,
      parte: 'comprador',
    }),
    enqueueOrderEmail({
      kind: 'dispute_resolved',
      ...destinatario(seller),
      disputa,
      parte: 'vendedor',
    }),
  ]);

  return { comprador, vendedor };
}

/** Al vendedor. Disparador: se inserta la `review` (MF-041). */
export function calificacionRecibida(
  seller: Destinatario,
  review: ResenaEmail,
): Promise<string | null> {
  return enqueueOrderEmail({ kind: 'review_received', ...destinatario(seller), resena: review });
}

/**
 * Al vendedor. Disparador: cambia `seller_profiles.seller_tier_id` (la
 * evaluacion de tiers, `seller_tier_auto_assign` / `auto_downgrade`).
 */
export function nivelDeVendedorActualizado(
  seller: Destinatario,
  tier: NivelVendedorEmail,
): Promise<string | null> {
  return enqueueOrderEmail({ kind: 'seller_tier_updated', ...destinatario(seller), nivel: tier });
}

export type {
  DisputaEmail,
  NivelVendedorEmail,
  OrdenEmail,
  ParteDeLaOrden,
  ResenaEmail,
  SeguimientoEmail,
} from '../templates/order.templates';
