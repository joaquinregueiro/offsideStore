import type { Database } from '@offside/database';

import {
  appendEvent,
  type AppendHistoryEvent,
  type HistoryEventType,
} from '../repositories/history-event.repository';

/**
 * Emision de HECHOS de confianza (DEC-036 / DEC-040).
 *
 * `user_history_events` es la fuente de verdad: `seller_reputations`,
 * `users.user_level` y `users.risk_level` se RECOMPUTAN desde aca. Este
 * Service es la unica puerta de escritura para los hechos que producen
 * `disputes` y `trust`; ningun repository de esos modulos escribe el historial
 * por su cuenta.
 *
 * ⚠️ SOLO HECHOS OBJETIVOS. "Se abrio una disputa" es un hecho; "el vendedor
 * es riesgoso" es una interpretacion, y eso va en `risk_events`. No mezclar.
 *
 * ⚠️ NO ATRAPA ERRORES, como `audit.record`: un hecho que afecta la reputacion
 * y no queda escrito es peor que una operacion rechazada. Por eso quien lo
 * llama pasa la MISMA transaccion en `db`.
 *
 * ⚠️ PROVISORIO EN SU UBICACION, no en su forma: cuando `users` exponga un
 * emisor generico (`userHistoryService.recordEvent`), este archivo delega y el
 * repository local desaparece. Las firmas de aca no cambian.
 */

export type { AppendHistoryEvent, HistoryEventType };

export async function emitHistoryEvent(event: AppendHistoryEvent, db?: Database): Promise<void> {
  await appendEvent(event, db);
}
