import { getDatabase, schema, type Database } from '@offside/database';
import { eq } from 'drizzle-orm';

/** Acceso a `refunds` (ERD §12.4). Sin reglas de negocio. */

export type RefundRow = typeof schema.refunds.$inferSelect;
export type RefundStatus = (typeof schema.refunds.status.enumValues)[number];
export type RefundType = (typeof schema.refunds.type.enumValues)[number];

const conn = (db?: Database): Database => db ?? getDatabase();

export async function findById(id: string, db?: Database): Promise<RefundRow | undefined> {
  const [row] = await conn(db)
    .select()
    .from(schema.refunds)
    .where(eq(schema.refunds.id, id))
    .limit(1);

  return row;
}

export async function findByPaymentId(paymentId: string, db?: Database): Promise<RefundRow[]> {
  return conn(db).select().from(schema.refunds).where(eq(schema.refunds.paymentId, paymentId));
}

/**
 * Crea el reembolso en estado `PROCESSING`, ANTES de llamar a Mercado Pago.
 *
 * Mismo criterio que `payments.insertPending`: si la llamada se cae, queda
 * rastro local de que se intento devolver dinero.
 */
export async function insertProcessing(
  values: {
    orderId: string;
    paymentId: string;
    type: RefundType;
    amount: bigint;
    currency: string;
    reason: string | null;
  },
  db?: Database,
): Promise<RefundRow> {
  const [row] = await conn(db)
    .insert(schema.refunds)
    .values({
      orderId: values.orderId,
      paymentId: values.paymentId,
      type: values.type,
      status: 'PROCESSING',
      amount: values.amount,
      currency: values.currency,
      reason: values.reason,
    })
    .returning();

  return row!;
}

export async function markCompleted(
  id: string,
  values: { mpRefundId: string | null; raw: unknown },
  db?: Database,
): Promise<RefundRow | undefined> {
  const [row] = await conn(db)
    .update(schema.refunds)
    .set({
      status: 'COMPLETED',
      mpRefundId: values.mpRefundId,
      raw: values.raw,
      processedAt: new Date(),
    })
    .where(eq(schema.refunds.id, id))
    .returning();

  return row;
}

export async function markRejected(id: string, db?: Database): Promise<RefundRow | undefined> {
  const [row] = await conn(db)
    .update(schema.refunds)
    .set({ status: 'REJECTED', processedAt: new Date() })
    .where(eq(schema.refunds.id, id))
    .returning();

  return row;
}
