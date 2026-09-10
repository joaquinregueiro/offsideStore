import { getDatabase, schema, type Database } from '@offside/database';
import { eq } from 'drizzle-orm';

/**
 * Acceso a `payment_webhook_events` (ERD §12.3). Sin reglas de negocio.
 *
 * ⚠️ `idempotency_key` es UNIQUE: es lo que impide procesar dos veces el mismo
 * evento (PC-041). El servicio inserta PRIMERO y usa la violacion del unico
 * como senal de duplicado.
 */

export type WebhookEventRow = typeof schema.paymentWebhookEvents.$inferSelect;

const conn = (db?: Database): Database => db ?? getDatabase();

/** Codigo de PostgreSQL para violacion de restriccion unica. */
const UNIQUE_VIOLATION = '23505';

/**
 * Drizzle ENVUELVE el error de PostgreSQL: el codigo viaja en `cause`, no en la
 * excepcion de arriba. Se recorre la cadena, porque mirar solo el primer nivel
 * hace que un duplicado parezca un error real y rompa la idempotencia.
 */
function esViolacionDeUnico(error: unknown): boolean {
  let actual: unknown = error;

  for (
    let profundidad = 0;
    profundidad < 5 && actual !== null && actual !== undefined;
    profundidad++
  ) {
    if (typeof actual === 'object' && 'code' in actual) {
      if ((actual as { code?: unknown }).code === UNIQUE_VIOLATION) return true;
    }

    actual = typeof actual === 'object' ? (actual as { cause?: unknown }).cause : undefined;
  }

  return false;
}

export interface RecordEventInput {
  provider: string;
  eventType: string;
  resourceId: string | null;
  idempotencyKey: string;
  signatureValid: boolean;
  payload: unknown;
}

/**
 * Registra el evento. Devuelve `null` si YA existia: ese es el duplicado.
 *
 * No lanza ante el duplicado porque no es un error, es el caso esperado cuando
 * Mercado Pago reintenta.
 */
export async function recordIfNew(
  input: RecordEventInput,
  db?: Database,
): Promise<WebhookEventRow | null> {
  try {
    const [row] = await conn(db)
      .insert(schema.paymentWebhookEvents)
      .values({
        provider: input.provider,
        eventType: input.eventType,
        resourceId: input.resourceId,
        idempotencyKey: input.idempotencyKey,
        signatureValid: input.signatureValid,
        payload: input.payload,
      })
      .returning();

    return row!;
  } catch (error) {
    if (esViolacionDeUnico(error)) return null;
    throw error;
  }
}

export async function markProcessed(
  id: string,
  outcome: { error?: string | undefined },
  db?: Database,
): Promise<void> {
  await conn(db)
    .update(schema.paymentWebhookEvents)
    .set({ processed: true, processedAt: new Date(), error: outcome.error ?? null })
    .where(eq(schema.paymentWebhookEvents.id, id));
}

export async function findByIdempotencyKey(
  idempotencyKey: string,
  db?: Database,
): Promise<WebhookEventRow | undefined> {
  const [row] = await conn(db)
    .select()
    .from(schema.paymentWebhookEvents)
    .where(eq(schema.paymentWebhookEvents.idempotencyKey, idempotencyKey))
    .limit(1);

  return row;
}
