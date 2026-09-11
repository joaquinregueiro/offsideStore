import type { Database } from '@offside/database';

import type { PublicUser } from '../../auth/services/auth.service';
import * as errors from '../inapp.errors';
import * as notificationRepo from '../repositories/notification.repository';

/**
 * Bandeja in-app (ERD §18, `notifications-and-engagement.md` §2.2).
 *
 * Es la "campanita": una fila por aviso, con `read_at` para saber si se vio.
 *
 * ⚠️ NO MANDA EMAIL. Los dos canales son independientes a proposito: el email
 * tiene su puerto (SES), su lista de supresion y su cola; un aviso in-app es
 * un INSERT. Si un hecho tiene que ir por los dos canales, quien lo emite
 * llama a los dos Services. Mezclarlos aca haria que un rebote de email
 * pudiera frenar la campanita, que no tiene nada que ver.
 *
 * ⚠️ SIN COLA. `notifications-and-engagement.md` §2.2 dice "el envio se
 * procesa por BullMQ", pero eso aplica al ENVIO (email/push); escribir una
 * fila en la bandeja propia no tiene nada que despachar. Encolar un INSERT
 * seria sumar un salto asincronico para nada (DEC-032).
 */

export type { NotificationRow, NotificationType } from '../repositories/notification.repository';

/** Techo del titulo. Es limite de UI, no regla de negocio. */
const TITULO_MAXIMO = 200;
/** Techo del cuerpo. Un aviso es un aviso: el detalle va en `payload`. */
const CUERPO_MAXIMO = 2_000;
/** Tamaño de pagina de la bandeja. */
export const NOTIFICACIONES_POR_PAGINA = 20;

export interface NotifyInput {
  userId: string;
  type: notificationRepo.NotificationType;
  title: string;
  body?: string | null;
  /**
   * Datos para que la pantalla enlace al hecho (`{ orderId }`,
   * `{ listingId, oldPrice, newPrice }`, ...). Es `jsonb` libre a proposito:
   * cada `type` define su forma y la pantalla la interpreta.
   */
  payload?: unknown;
}

export interface PublicNotification {
  id: string;
  type: notificationRepo.NotificationType;
  title: string;
  body: string | null;
  payload: unknown;
  leida: boolean;
  readAt: string | null;
  createdAt: string;
}

export function toPublicNotification(row: notificationRepo.NotificationRow): PublicNotification {
  return {
    id: row.id,
    type: row.type,
    // `title` es nullable en el ERD, pero este Service nunca inserta null.
    title: row.title ?? '',
    body: row.body,
    payload: row.payload,
    leida: row.readAt !== null,
    readAt: row.readAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

function validar(input: NotifyInput): { title: string; body: string | null } {
  const title = input.title.trim();
  if (title === '') throw errors.notificationInvalid('el título no puede estar vacío');
  if (title.length > TITULO_MAXIMO) {
    throw errors.notificationInvalid(`el título supera los ${TITULO_MAXIMO} caracteres`);
  }

  const body = input.body?.trim() ?? '';
  if (body.length > CUERPO_MAXIMO) {
    throw errors.notificationInvalid(`el cuerpo supera los ${CUERPO_MAXIMO} caracteres`);
  }

  return { title, body: body === '' ? null : body };
}

/**
 * Emite un aviso a UN usuario.
 *
 * Firma POSICIONAL a proposito —`notify(userId, type, title, body, payload)`—
 * porque es la que el resto de los modulos (orders, payments, questions) va a
 * llamar, y un objeto de entrada para cinco valores no aporta nada.
 *
 * Recibe `db` opcional para que quien emite desde una transaccion —la orden
 * que pasa a `PAID`, el cambio de precio— deje el aviso en la MISMA: si la
 * operacion se revierte, el aviso no queda huerfano contando algo que no paso.
 */
export async function notify(
  userId: string,
  type: notificationRepo.NotificationType,
  title: string,
  body?: string | null,
  payload?: unknown,
  db?: Database,
): Promise<PublicNotification> {
  const validado = validar({ userId, type, title, body: body ?? null, payload });

  const row = await notificationRepo.insert(
    { userId, type, title: validado.title, body: validado.body, payload: payload ?? null },
    db,
  );

  return toPublicNotification(row);
}

/**
 * Emite el MISMO aviso a varios usuarios, en un solo insert.
 *
 * Es lo que usa la alerta de precio: una baja, N favoritos, N filas. Devuelve
 * cuantas se crearon. Los ids repetidos se colapsan: nadie recibe dos veces el
 * mismo hecho por un bug de quien arma la lista.
 */
export async function notifyMany(
  userIds: string[],
  aviso: Omit<NotifyInput, 'userId'>,
  db?: Database,
): Promise<number> {
  const { title, body } = validar({ ...aviso, userId: '' });
  const unicos = [...new Set(userIds)];

  return notificationRepo.insertMany(
    unicos.map((userId) => ({
      userId,
      type: aviso.type,
      title,
      body,
      payload: aviso.payload ?? null,
    })),
    db,
  );
}

export interface ListNotificationsOptions {
  soloNoLeidas?: boolean;
  /** Empieza en 1. Fuera de rango se trata como 1. */
  pagina?: number;
}

export interface NotificationPage {
  notificaciones: PublicNotification[];
  total: number;
  pagina: number;
  porPagina: number;
}

/**
 * Bandeja del usuario autenticado, paginada.
 *
 * ⚠️ SIEMPRE SOBRE `user.id`: no hay parametro de usuario que manipular.
 */
export async function listNotifications(
  user: PublicUser,
  opciones: ListNotificationsOptions = {},
): Promise<NotificationPage> {
  const soloNoLeidas = opciones.soloNoLeidas ?? false;
  const pagina = normalizarPagina(opciones.pagina);

  const [filas, total] = await Promise.all([
    notificationRepo.findByUserId(user.id, {
      soloNoLeidas,
      limite: NOTIFICACIONES_POR_PAGINA,
      offset: (pagina - 1) * NOTIFICACIONES_POR_PAGINA,
    }),
    notificationRepo.countByUserId(user.id, soloNoLeidas),
  ]);

  return {
    notificaciones: filas.map(toPublicNotification),
    total,
    pagina,
    porPagina: NOTIFICACIONES_POR_PAGINA,
  };
}

/**
 * Marca una notificacion como leida.
 *
 * Lanza `NOTIFICATION_NOT_FOUND` si no existe o es de otro usuario: los dos
 * casos se ven igual desde afuera. Marcar una ya leida NO es un error: es la
 * misma idempotencia que un doble click merece.
 */
export async function markRead(user: PublicUser, notificationId: string): Promise<void> {
  const marcada = await notificationRepo.markRead(notificationId, user.id);
  if (marcada) return;

  const existe = await notificationRepo.findByIdForUser(notificationId, user.id);
  if (existe === undefined) throw errors.notificationNotFound();
}

/** Marca todas como leidas. Devuelve cuantas cambiaron. */
export async function markAllRead(user: PublicUser): Promise<number> {
  return notificationRepo.markAllRead(user.id);
}

/** Cuantas sin leer. Es lo que pinta el numerito de la campanita. */
export async function countUnread(user: PublicUser): Promise<number> {
  return notificationRepo.countByUserId(user.id, true);
}

/** Pagina valida: entero >= 1. Cualquier otra cosa es la primera. */
export function normalizarPagina(pagina: number | undefined): number {
  if (pagina === undefined || !Number.isInteger(pagina) || pagina < 1) return 1;

  return pagina;
}
