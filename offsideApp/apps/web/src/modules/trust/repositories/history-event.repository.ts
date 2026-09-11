import { getDatabase, schema, type Database } from '@offside/database';

/**
 * Escritura en `user_history_events` (ERD §6.3) desde el modulo trust.
 *
 * ⚠️ APPEND-ONLY, igual que el repository de `users`: solo insert. Los hechos
 * no se modifican ni desaparecen.
 *
 * ⚠️ DUPLICA LA CONSULTA DE `users/repositories/user-history.repository.ts`, y
 * es a proposito: un modulo no importa el repository de otro
 * (`modules/README.md`), y el Service de `users` hoy solo sabe registrar
 * `USER_REGISTERED`. Los hechos de disputas y sanciones tienen que emitirse
 * igual (DEC-036: el historial es la fuente de verdad de la confianza), asi que
 * la escritura vive aca hasta que `users` exponga un emisor generico. Ver
 * `services/history.service.ts`.
 */

export type HistoryEventType = (typeof schema.userHistoryEvents.eventType.enumValues)[number];

const conn = (db?: Database): Database => db ?? getDatabase();

export interface AppendHistoryEvent {
  userId: string;
  eventType: HistoryEventType;
  /** 'buyer' / 'seller' segun el rol del usuario en el hecho. */
  role: 'buyer' | 'seller';
  refEntityType: string;
  refEntityId: string;
  data?: Record<string, unknown> | undefined;
}

export async function appendEvent(event: AppendHistoryEvent, db?: Database): Promise<void> {
  await conn(db)
    .insert(schema.userHistoryEvents)
    .values({
      userId: event.userId,
      eventType: event.eventType,
      role: event.role,
      refEntityType: event.refEntityType,
      refEntityId: event.refEntityId,
      data: event.data ?? null,
    });
}
