import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { users } from './auth';
import { listings } from './listings';

/**
 * Modulo QUESTIONS — preguntas y respuestas en la ficha de una publicacion.
 *
 * =============================================================================
 * ⚠️ ESTA TABLA NO ESTA EN EL ERD v1.3
 * =============================================================================
 *
 * `database-design.md` §24 lista 52 tablas y ninguna cubre el intercambio
 * publico comprador↔vendedor sobre una publicacion. BR-053 (SHOULD) pide que la
 * comunicacion ocurra dentro de la plataforma y marca la mensajeria in-app como
 * 🟡 feature futura; el ERD no la modelo.
 *
 * La tabla la AUTORIZO EL OWNER el 2026-09-10 al pedir "todas las funciones de
 * Mercado Libre". Es un cambio ARQUITECTONICO (CLAUDE.md §5) y por eso no se
 * tomo desde el codigo. ⚠️ Falta reflejarlo en `docs/04-technical/
 * database-design.md`, que es solo lectura (§3): el delta exacto esta en
 * `docs-implementation/erd-delta-2026-09-10.md` para que el owner lo lleve al
 * ERD. Hasta entonces, ERD y schema no coinciden en esta tabla.
 *
 * =============================================================================
 * DISEÑO
 * =============================================================================
 *
 * Es un modelo de PREGUNTA CON UNA RESPUESTA, como la ficha de Mercado Libre:
 * no es un hilo ni un chat. La respuesta vive en la misma fila porque hay a lo
 * sumo una y la responde el vendedor; una tabla aparte de "respuestas" seria
 * modelar una conversacion que el producto no ofrece (BR-053: mensajeria 🟡).
 *
 * `status` es `text` y no un enum de dominio A PROPOSITO: agregar un valor a un
 * `pgEnum` es un cambio de esquema (CLAUDE.md §5) y el vocabulario de
 * moderacion de preguntas todavia no esta decidido. El CHECK fija los tres
 * valores conocidos para que un typo no invente un cuarto estado en silencio.
 *
 *   open      → pregunta publicada, sin responder
 *   answered  → el vendedor respondio (`answer`, `answered_at`, `answered_by`)
 *   hidden    → la oculto quien pregunto, el vendedor o moderacion; sigue en la
 *               tabla como evidencia
 *
 * FKs RESTRICT en las tres: una pregunta es evidencia de lo que se dijo antes
 * de una compra (util en una disputa), y no se pierde porque alguien borre su
 * cuenta o su publicacion —que ademas son soft delete—. Se elimina de forma
 * LOGICA con `deleted_at`, como toda entidad de negocio (ERD §20.10).
 */
export const listingQuestions = pgTable(
  'listing_questions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    listingId: uuid('listing_id')
      .notNull()
      .references(() => listings.id, { onDelete: 'restrict' }),
    /** Quien pregunta. Nunca el dueño de la publicacion (validado en app). */
    askerId: uuid('asker_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    question: text('question').notNull(),
    /** Null mientras `status = 'open'`. */
    answer: text('answer'),
    answeredAt: timestamp('answered_at', { withTimezone: true }),
    /**
     * Quien respondio. Es un `users.id` y no el `seller_profiles.id` para que
     * el dia que responda moderacion o soporte no haga falta otra columna.
     */
    answeredBy: uuid('answered_by').references(() => users.id, { onDelete: 'restrict' }),
    /** open | answered | hidden. Ver el CHECK. */
    status: text('status').notNull().default('open'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    /** Soft delete (ERD §20.10). */
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    /** La ficha lista las preguntas de UNA publicacion. */
    index('listing_questions_listing_id_idx').on(t.listingId),
    /** "Mis preguntas" del comprador. */
    index('listing_questions_asker_id_idx').on(t.askerId),
    check('listing_questions_status_check', sql`${t.status} IN ('open', 'answered', 'hidden')`),
  ],
);
