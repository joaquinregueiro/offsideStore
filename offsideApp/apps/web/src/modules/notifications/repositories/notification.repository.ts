import { getDatabase, schema, type Database } from '@offside/database';
import { and, count, desc, eq, isNull } from 'drizzle-orm';

/**
 * Acceso a `notifications` (ERD §18): la campanita in-app. Sin reglas de
 * negocio.
 *
 * ⚠️ NO ES EL REGISTRO DE EMAILS. El ERD lo dice con todas las letras: esta
 * tabla no tiene direccion, ni estado de entrega, ni proveedor. Lo que se manda
 * por email vive en `email.service.ts`, detras del puerto de SES.
 */

export type NotificationRow = typeof schema.notifications.$inferSelect;
export type NotificationType = NotificationRow['type'];

const conn = (db?: Database): Database => db ?? getDatabase();

export interface InsertNotificationValues {
  userId: string;
  type: NotificationType;
  title: string;
  body: string | null;
  payload: unknown;
}

export async function insert(
  values: InsertNotificationValues,
  db?: Database,
): Promise<NotificationRow> {
  const [row] = await conn(db)
    .insert(schema.notifications)
    .values({
      userId: values.userId,
      type: values.type,
      title: values.title,
      body: values.body,
      payload: values.payload ?? null,
    })
    .returning();

  return row!;
}

/**
 * Varias notificaciones en UN insert.
 *
 * Existe para las alertas de precio: una baja se avisa a todos los que tienen
 * la publicacion en favoritos, y hacer un INSERT por persona seria N viajes a
 * la base por un solo hecho.
 */
export async function insertMany(
  values: InsertNotificationValues[],
  db?: Database,
): Promise<number> {
  if (values.length === 0) return 0;

  const filas = await conn(db)
    .insert(schema.notifications)
    .values(
      values.map((v) => ({
        userId: v.userId,
        type: v.type,
        title: v.title,
        body: v.body,
        payload: v.payload ?? null,
      })),
    )
    .returning({ id: schema.notifications.id });

  return filas.length;
}

export interface FindByUserOptions {
  soloNoLeidas: boolean;
  limite: number;
  offset: number;
}

/**
 * Bandeja de un usuario, mas nueva primero.
 *
 * ⚠️ EL `ORDER BY` NO ES COSMETICO: marcar como leida hace un UPDATE y sin
 * orden explicito PostgreSQL reordena las filas, con lo que la bandeja se
 * barajaria sola al tocarla.
 */
export async function findByUserId(
  userId: string,
  opciones: FindByUserOptions,
  db?: Database,
): Promise<NotificationRow[]> {
  const condiciones = [eq(schema.notifications.userId, userId)];
  if (opciones.soloNoLeidas) condiciones.push(isNull(schema.notifications.readAt));

  return conn(db)
    .select()
    .from(schema.notifications)
    .where(and(...condiciones))
    .orderBy(desc(schema.notifications.createdAt), desc(schema.notifications.id))
    .limit(opciones.limite)
    .offset(opciones.offset);
}

export async function countByUserId(
  userId: string,
  soloNoLeidas: boolean,
  db?: Database,
): Promise<number> {
  const condiciones = [eq(schema.notifications.userId, userId)];
  if (soloNoLeidas) condiciones.push(isNull(schema.notifications.readAt));

  const [fila] = await conn(db)
    .select({ cantidad: count() })
    .from(schema.notifications)
    .where(and(...condiciones));

  return Number(fila?.cantidad ?? 0);
}

/**
 * Marca UNA notificacion como leida.
 *
 * ⚠️ EL `user_id` VA EN EL WHERE, no en una lectura previa: asi es imposible
 * marcar la de otro aunque se adivine el id. Devuelve `false` si no habia fila
 * (inexistente, ajena o ya leida: para quien llama son lo mismo).
 */
export async function markRead(id: string, userId: string, db?: Database): Promise<boolean> {
  const filas = await conn(db)
    .update(schema.notifications)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(schema.notifications.id, id),
        eq(schema.notifications.userId, userId),
        isNull(schema.notifications.readAt),
      ),
    )
    .returning({ id: schema.notifications.id });

  return filas.length === 1;
}

/** Marca todas las no leidas de un usuario. Devuelve cuantas marco. */
export async function markAllRead(userId: string, db?: Database): Promise<number> {
  const filas = await conn(db)
    .update(schema.notifications)
    .set({ readAt: new Date() })
    .where(and(eq(schema.notifications.userId, userId), isNull(schema.notifications.readAt)))
    .returning({ id: schema.notifications.id });

  return filas.length;
}

/** Una notificacion, si existe y es del usuario. */
export async function findByIdForUser(
  id: string,
  userId: string,
  db?: Database,
): Promise<NotificationRow | undefined> {
  const [row] = await conn(db)
    .select()
    .from(schema.notifications)
    .where(and(eq(schema.notifications.id, id), eq(schema.notifications.userId, userId)))
    .limit(1);

  return row;
}
