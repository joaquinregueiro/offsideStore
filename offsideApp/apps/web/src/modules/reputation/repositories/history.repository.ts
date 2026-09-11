import { getDatabase, schema, type Database } from '@offside/database';
import { and, eq, inArray, sql } from 'drizzle-orm';

/**
 * Lectura y emision de HECHOS en `user_history_events` (ERD §6.3, DEC-036).
 * Sin reglas de negocio.
 *
 * ⚠️ APPEND-ONLY: solo insert y lectura. No hay update ni delete a proposito.
 *
 * ⚠️ POR QUE ESTE MODULO ESCRIBE EN LA TABLA DE `users`: `users` es el dueño
 * de la tabla, pero su Service solo sabe emitir `USER_REGISTERED`, y un
 * modulo no puede importar el Repository de otro (`modules/README.md`). Los
 * hechos que afectan reputacion —venta completada, cancelacion, review
 * recibida— son exactamente los que este modulo proyecta, asi que se emiten
 * desde aca con la misma disciplina: solo hechos, sin interpretacion.
 */

export type HistoryEventType = (typeof schema.historyEventType.enumValues)[number];

const conn = (db?: Database): Database => db ?? getDatabase();

export interface FactToAppend {
  userId: string;
  eventType: HistoryEventType;
  role: 'buyer' | 'seller';
  refEntityType: 'order' | 'dispute' | 'refund' | 'review';
  refEntityId: string;
  data?: Record<string, unknown> | undefined;
}

/**
 * Inserta el hecho SOLO si no existe ya uno igual (mismo usuario, tipo y
 * entidad de origen). Devuelve `true` si inserto.
 *
 * ⚠️ IDEMPOTENTE A PROPOSITO: los hooks se llaman desde transiciones de orden
 * que pueden reintentarse (webhooks, jobs), y un hecho duplicado contaria una
 * venta dos veces en `sales_count` y en el nivel del usuario. No hay UNIQUE
 * en la tabla porque el ERD la define como log libre, asi que la
 * comprobacion es previa; quien necesite atomicidad total pasa una transaccion.
 */
export async function appendFactIfMissing(fact: FactToAppend, db?: Database): Promise<boolean> {
  const existente = await conn(db)
    .select({ id: schema.userHistoryEvents.id })
    .from(schema.userHistoryEvents)
    .where(
      and(
        eq(schema.userHistoryEvents.userId, fact.userId),
        eq(schema.userHistoryEvents.eventType, fact.eventType),
        eq(schema.userHistoryEvents.refEntityType, fact.refEntityType),
        eq(schema.userHistoryEvents.refEntityId, fact.refEntityId),
      ),
    )
    .limit(1);

  if (existente.length > 0) return false;

  await conn(db)
    .insert(schema.userHistoryEvents)
    .values({
      userId: fact.userId,
      eventType: fact.eventType,
      role: fact.role,
      refEntityType: fact.refEntityType,
      refEntityId: fact.refEntityId,
      data: fact.data ?? null,
    });

  return true;
}

/** Cantidad de hechos de esos tipos para el usuario, opcionalmente por rol. */
export async function countEvents(
  userId: string,
  eventTypes: readonly HistoryEventType[],
  role?: 'buyer' | 'seller',
  db?: Database,
): Promise<number> {
  const condiciones = [
    eq(schema.userHistoryEvents.userId, userId),
    inArray(schema.userHistoryEvents.eventType, [...eventTypes]),
  ];
  if (role !== undefined) condiciones.push(eq(schema.userHistoryEvents.role, role));

  const [row] = await conn(db)
    .select({ total: sql<number>`count(*)::int` })
    .from(schema.userHistoryEvents)
    .where(and(...condiciones));

  return row?.total ?? 0;
}

/**
 * Cancelaciones atribuibles al VENDEDOR: hechos `ORDER_CANCELLED` sobre su
 * usuario, con rol vendedor y `data.cancelledBy = 'seller'`.
 *
 * Una orden cancelada porque vencio la ventana de pago (`system`) o porque el
 * comprador se arrepintio (`buyer`) tambien es un hecho del historial del
 * vendedor, pero no es SU cancelacion y no le baja la reputacion.
 */
export async function countSellerCancellations(
  sellerUserId: string,
  db?: Database,
): Promise<number> {
  const [row] = await conn(db)
    .select({ total: sql<number>`count(*)::int` })
    .from(schema.userHistoryEvents)
    .where(
      and(
        eq(schema.userHistoryEvents.userId, sellerUserId),
        eq(schema.userHistoryEvents.eventType, 'ORDER_CANCELLED'),
        eq(schema.userHistoryEvents.role, 'seller'),
        sql`${schema.userHistoryEvents.data} ->> 'cancelledBy' = 'seller'`,
      ),
    );

  return row?.total ?? 0;
}
