import { getDatabase, schema, type Database } from '@offside/database';
import type { InferInsertModel } from 'drizzle-orm';

/** Acceso a `user_history_events` (ERD §6.3). Sin reglas de negocio. */

type HistoryInsert = InferInsertModel<typeof schema.userHistoryEvents>;

const conn = (db?: Database): Database => db ?? getDatabase();

/**
 * Inserta un hecho en el historial.
 *
 * ⚠️ APPEND-ONLY (ERD §6.3): este repository expone SOLO insert y lectura.
 * No hay update ni delete a proposito — los hechos no se modifican ni
 * desaparecen. `user_level`, `risk_level` y `seller_reputations` se DERIVAN de
 * aca.
 */
export async function appendEvent(event: HistoryInsert, db?: Database): Promise<void> {
  await conn(db).insert(schema.userHistoryEvents).values(event);
}
