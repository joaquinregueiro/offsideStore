import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { users } from './auth';
import { listings } from './listings';

/**
 * Modulo REPORTS — denuncias de publicaciones hechas por usuarios.
 *
 * =============================================================================
 * ⚠️ ESTA TABLA NO ESTA EN EL ERD v1.3
 * =============================================================================
 *
 * Segundo delta del 2026-09-10, autorizado por el owner (ver
 * `docs-implementation/erd-delta-2026-09-10.md`). `trust-and-safety.md` habla
 * de "marcas/flags de autenticidad dudosa" y de moderacion, pero el ERD no
 * modelo de donde salen esas marcas cuando las hace un usuario y no el
 * sistema: `risk_events` es interpretacion del sistema (DEC-040), no una
 * denuncia de una persona.
 *
 * =============================================================================
 * DISEÑO
 * =============================================================================
 *
 * Una denuncia es una PERSONA diciendo algo sobre una PUBLICACION, y despues
 * moderacion decide. Por eso tres cosas quedan separadas: lo que dijo
 * (`reason` + `note`), en que quedo (`status`) y quien lo resolvio
 * (`reviewed_by` + `reviewed_at`).
 *
 * `reason` es `text` y no enum: el vocabulario de motivos (falsificacion,
 * precio engañoso, fotos ajenas, ...) es de producto y todavia no esta
 * decidido. Se valida en la app contra una lista; fijarlo en el esquema seria
 * inventarlo. `status` tambien es `text` pero con CHECK, como en
 * `listing_questions`: los tres estados si estan definidos.
 *
 *   open       → recibida, nadie la miro
 *   reviewed   → moderacion la atendio (que hizo con la publicacion es otra
 *                cosa: `listings.moderation_status`)
 *   dismissed  → moderacion la descarto. Se conserva: quien denuncia de mas
 *                tambien es una señal
 *
 * UNIQUE(listing_id, reporter_id): una persona denuncia una publicacion UNA
 * vez. Sin esto, un solo usuario podria hacer que una publicacion parezca
 * denunciada por cien. Si quiere cambiar el motivo, edita la fila.
 *
 * Sin `deleted_at`: una denuncia no se borra ni se "des-denuncia"; se descarta
 * (`dismissed`) y queda.
 *
 * FKs RESTRICT: la denuncia es evidencia para moderacion y para disputas, y no
 * desaparece porque alguien borre su cuenta o su publicacion.
 */
export const listingReports = pgTable(
  'listing_reports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    listingId: uuid('listing_id')
      .notNull()
      .references(() => listings.id, { onDelete: 'restrict' }),
    /** Quien denuncia. Nunca el dueño de la publicacion (validado en app). */
    reporterId: uuid('reporter_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    /** Motivo, de una lista que valida la app. */
    reason: text('reason').notNull(),
    /** Texto libre opcional de quien denuncia. */
    note: text('note'),
    /** open | reviewed | dismissed. Ver el CHECK. */
    status: text('status').notNull().default('open'),
    /**
     * Quien la resolvio. Exige una capacidad de moderacion en
     * `lib/permissions.ts` (DEC-023) que hoy no existe: `MODERATOR` sigue sin
     * capacidades.
     */
    reviewedBy: uuid('reviewed_by').references(() => users.id, { onDelete: 'restrict' }),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('listing_reports_listing_id_reporter_id_key').on(t.listingId, t.reporterId),
    /** La cola de moderacion: "las abiertas", y "cuantas tiene esta publicacion". */
    index('listing_reports_status_idx').on(t.status),
    check('listing_reports_status_check', sql`${t.status} IN ('open', 'reviewed', 'dismissed')`),
  ],
);
