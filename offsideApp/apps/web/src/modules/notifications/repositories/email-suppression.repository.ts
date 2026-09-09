import { getDatabase, schema, type Database } from '@offside/database';
import { and, eq, isNull } from 'drizzle-orm';

/** Acceso a `email_suppressions`. Sin reglas: decide el Service. */

const conn = (db?: Database): Database => db ?? getDatabase();

export interface SuppressionRow {
  id: string;
  email: string;
  reason: 'BOUNCE' | 'COMPLAINT';
  providerSubtype: string | null;
  suppressedAt: Date;
}

/** La supresion VIGENTE de una direccion, si la hay. */
export async function findActive(
  email: string,
  db?: Database,
): Promise<SuppressionRow | undefined> {
  const [fila] = await conn(db)
    .select({
      id: schema.emailSuppressions.id,
      email: schema.emailSuppressions.email,
      reason: schema.emailSuppressions.reason,
      providerSubtype: schema.emailSuppressions.providerSubtype,
      suppressedAt: schema.emailSuppressions.suppressedAt,
    })
    .from(schema.emailSuppressions)
    .where(
      and(eq(schema.emailSuppressions.email, email), isNull(schema.emailSuppressions.releasedAt)),
    )
    .limit(1);

  return fila;
}

export interface SuppressInput {
  email: string;
  reason: 'BOUNCE' | 'COMPLAINT';
  providerSubtype: string | null;
  providerMessageId: string | null;
  raw: unknown;
}

/**
 * Suprime una direccion.
 *
 * ⚠️ ES UN UPSERT, Y ESO ES LO QUE LA VUELVE IDEMPOTENTE. SNS reintenta y
 * entrega desordenado —igual que los webhooks de Mercado Pago—, asi que la
 * misma notificacion puede llegar dos veces. Con `INSERT` a secas la segunda
 * reventaria contra el UNIQUE y el endpoint devolveria un error que haria que
 * SNS reintentara para siempre.
 *
 * ⚠️ Un rebote nuevo sobre una direccion LIBERADA vuelve a suprimirla: se pisa
 * `released_at` con NULL. Si no, alguien podria liberar una casilla rota y
 * quedaria recibiendo rebotes indefinidamente.
 */
export async function suppress(input: SuppressInput, db?: Database): Promise<void> {
  const ahora = new Date();

  await conn(db)
    .insert(schema.emailSuppressions)
    .values({
      email: input.email,
      reason: input.reason,
      providerSubtype: input.providerSubtype,
      providerMessageId: input.providerMessageId,
      raw: input.raw,
      suppressedAt: ahora,
    })
    .onConflictDoUpdate({
      target: schema.emailSuppressions.email,
      set: {
        reason: input.reason,
        providerSubtype: input.providerSubtype,
        providerMessageId: input.providerMessageId,
        raw: input.raw,
        suppressedAt: ahora,
        releasedAt: null,
        releasedBy: null,
        updatedAt: ahora,
      },
    });
}

/**
 * Levanta la supresion de una direccion.
 *
 * ⚠️ NO BORRA LA FILA. Que una direccion haya rebotado es un hecho, y perderlo
 * significa no poder explicar despues por que estuvo muda. Se marca liberada y
 * queda quien lo hizo.
 */
export async function release(email: string, adminId: string, db?: Database): Promise<boolean> {
  const filas = await conn(db)
    .update(schema.emailSuppressions)
    .set({ releasedAt: new Date(), releasedBy: adminId, updatedAt: new Date() })
    .where(
      and(eq(schema.emailSuppressions.email, email), isNull(schema.emailSuppressions.releasedAt)),
    )
    .returning({ id: schema.emailSuppressions.id });

  return filas.length > 0;
}
