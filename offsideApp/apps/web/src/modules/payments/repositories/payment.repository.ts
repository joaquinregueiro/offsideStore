import { getDatabase, schema, type Database } from '@offside/database';
import { and, eq } from 'drizzle-orm';

/** Acceso a `payments` y `payment_splits` (ERD §12.1 y §12.2). Sin reglas. */

export type PaymentRow = typeof schema.payments.$inferSelect;
export type PaymentStatus = (typeof schema.payments.status.enumValues)[number];
export type PaymentSplitRow = typeof schema.paymentSplits.$inferSelect;

const conn = (db?: Database): Database => db ?? getDatabase();

export async function findById(id: string, db?: Database): Promise<PaymentRow | undefined> {
  const [row] = await conn(db)
    .select()
    .from(schema.payments)
    .where(eq(schema.payments.id, id))
    .limit(1);

  return row;
}

export async function findByMpPaymentId(
  mpPaymentId: string,
  db?: Database,
): Promise<PaymentRow | undefined> {
  const [row] = await conn(db)
    .select()
    .from(schema.payments)
    .where(eq(schema.payments.mpPaymentId, mpPaymentId))
    .limit(1);

  return row;
}

export async function findByPreferenceId(
  mpPreferenceId: string,
  db?: Database,
): Promise<PaymentRow | undefined> {
  const [row] = await conn(db)
    .select()
    .from(schema.payments)
    .where(eq(schema.payments.mpPreferenceId, mpPreferenceId))
    .limit(1);

  return row;
}

/** Pagos de una orden, del mas nuevo al mas viejo. */
export async function findByOrderId(orderId: string, db?: Database): Promise<PaymentRow[]> {
  return conn(db).select().from(schema.payments).where(eq(schema.payments.orderId, orderId));
}

/** Intento de pago vivo de una orden: `PENDING` con preferencia ya creada. */
export async function findReusablePending(
  orderId: string,
  db?: Database,
): Promise<PaymentRow | undefined> {
  const [row] = await conn(db)
    .select()
    .from(schema.payments)
    .where(and(eq(schema.payments.orderId, orderId), eq(schema.payments.status, 'PENDING')))
    .limit(1);

  return row;
}

/**
 * Crea la fila local ANTES de llamar a Mercado Pago (MP-PAY-004).
 *
 * Si se creara despues, un timeout dejaria un cobro en MP sin registro local.
 * Asi, en el peor caso queda una fila `PENDING` sin preferencia, que es
 * reconciliable.
 */
export async function insertPending(
  values: {
    orderId: string;
    amount: bigint;
    currency: string;
    idempotencyKey: string;
  },
  db?: Database,
): Promise<PaymentRow> {
  const [row] = await conn(db)
    .insert(schema.payments)
    .values({
      orderId: values.orderId,
      amount: values.amount,
      currency: values.currency,
      status: 'PENDING',
      // DEC-027: el unico checkout del MVP.
      checkoutType: 'pro',
      idempotencyKey: values.idempotencyKey,
    })
    .returning();

  return row!;
}

export async function attachPreference(
  paymentId: string,
  mpPreferenceId: string,
  db?: Database,
): Promise<PaymentRow | undefined> {
  const [row] = await conn(db)
    .update(schema.payments)
    .set({ mpPreferenceId, updatedAt: new Date() })
    .where(eq(schema.payments.id, paymentId))
    .returning();

  return row;
}

export interface PaymentSyncValues {
  status: PaymentStatus;
  mpPaymentId: string;
  mpStatus: string | null;
  mpStatusDetail: string | null;
  paymentMethod: string | null;
  installments: number | null;
  approvedAt: Date | null;
  raw: unknown;
}

/** Vuelca a la fila local lo que Mercado Pago informo. */
export async function applyMercadoPagoState(
  paymentId: string,
  values: PaymentSyncValues,
  db?: Database,
): Promise<PaymentRow | undefined> {
  const [row] = await conn(db)
    .update(schema.payments)
    .set({
      status: values.status,
      mpPaymentId: values.mpPaymentId,
      mpStatus: values.mpStatus,
      mpStatusDetail: values.mpStatusDetail,
      paymentMethod: values.paymentMethod,
      installments: values.installments,
      approvedAt: values.approvedAt,
      raw: values.raw,
      updatedAt: new Date(),
    })
    .where(eq(schema.payments.id, paymentId))
    .returning();

  return row;
}

/** Cambia solo el estado normalizado. Lo usan los reembolsos. */
export async function updateStatus(
  paymentId: string,
  status: PaymentStatus,
  db?: Database,
): Promise<PaymentRow | undefined> {
  const [row] = await conn(db)
    .update(schema.payments)
    .set({ status, updatedAt: new Date() })
    .where(eq(schema.payments.id, paymentId))
    .returning();

  return row;
}

/**
 * Registra el reparto REAL informado por Mercado Pago (ERD §26.2).
 *
 * ⚠️ NO es el snapshot comercial: eso vive en `orders` y es inmutable. Esta
 * tabla es la conciliacion, y **no alimenta ninguna logica de ajuste**
 * (MP-PAY-014, DEC-043).
 */
export async function insertSplit(
  values: {
    paymentId: string;
    sellerAmount: bigint;
    marketplaceFeeAmount: bigint;
    mpFeeAmount: bigint | null;
    currency: string;
    raw: unknown;
  },
  db?: Database,
): Promise<PaymentSplitRow> {
  const [row] = await conn(db)
    .insert(schema.paymentSplits)
    .values({
      paymentId: values.paymentId,
      sellerAmount: values.sellerAmount,
      marketplaceFeeAmount: values.marketplaceFeeAmount,
      mpFeeAmount: values.mpFeeAmount,
      currency: values.currency,
      raw: values.raw,
    })
    .returning();

  return row!;
}

export async function findSplitsByPaymentId(
  paymentId: string,
  db?: Database,
): Promise<PaymentSplitRow[]> {
  return conn(db)
    .select()
    .from(schema.paymentSplits)
    .where(eq(schema.paymentSplits.paymentId, paymentId));
}
