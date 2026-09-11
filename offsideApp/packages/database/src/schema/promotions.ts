import { sql } from 'drizzle-orm';
import { check, index, numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { users } from './auth';
import { listings } from './listings';
import { sellerProfiles } from './sellers';

/**
 * Modulo PROMOTIONS — historial de promociones de una publicacion.
 *
 * =============================================================================
 * ⚠️ ESTA TABLA NO ESTA EN EL ERD v1.3
 * =============================================================================
 *
 * Es el SEGUNDO delta del 2026-09-10, autorizado por el owner en la misma
 * conversacion que `listing_questions` y `listings.promoted_until` (ver
 * `docs-implementation/erd-delta-2026-09-10.md`). El primer delta dejo
 * anotado, en su §7.7, que si el negocio necesitaba auditar cuantas veces se
 * promociono algo iba a hacer falta esta tabla: el owner la pidio.
 *
 * =============================================================================
 * DISEÑO
 * =============================================================================
 *
 * `listings.promoted_until` sigue siendo la PROYECCION RAPIDA —la vitrina y la
 * busqueda solo miran esa columna— y esta tabla es el HISTORIAL: una fila por
 * cada vez que se promociono una publicacion. Las dos cosas se escriben en la
 * misma transaccion; si difieren, manda el historial, que es evidencia.
 *
 * `commission_multiplier_snapshot` congela el multiplicador vigente en
 * `app_settings.promotion_commission_multiplier` AL PROMOCIONAR. No es
 * redundante con `orders.promotion_multiplier_at_transaction`: aca queda lo
 * que se le prometio al vendedor cuando acepto promocionar, y en la orden lo
 * que efectivamente se cobro. Si un admin cambia el multiplicador a mitad de
 * una promocion, la orden copia ESTE snapshot y no el valor nuevo (DEC-030):
 * el vendedor acepto x3, no "lo que valga cuando alguien compre".
 *
 * `status` es `text` con CHECK y no un enum de dominio, por el mismo motivo
 * que `listing_questions.status`: ampliar un `pgEnum` es un cambio de esquema
 * y el vocabulario todavia se esta asentando.
 *
 *   active     → vigente. `listings.promoted_until` deberia ser = `ends_at`.
 *   ended      → vencio por tiempo. La marca un barrido, no una persona.
 *   cancelled  → la corto el vendedor o moderacion antes de `ends_at`
 *                (`cancelled_at`). Se conserva: cobrar una comision mayor y
 *                despues "olvidar" que hubo promocion no puede pasar.
 *
 * FKs RESTRICT en todas: una promocion explica por que una orden pago la
 * comision que pago; no se pierde porque desaparezca su publicacion, su
 * vendedor o quien la creo —que ademas son soft delete—.
 */
export const listingPromotions = pgTable(
  'listing_promotions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    listingId: uuid('listing_id')
      .notNull()
      .references(() => listings.id, { onDelete: 'restrict' }),
    /**
     * Redundante con `listings.seller_id` A PROPOSITO: "cuantas promociones
     * hizo este vendedor" es la consulta de moderacion y de facturacion, y
     * pasar por `listings` cada vez para eso no aporta integridad —una
     * publicacion no cambia de dueño—.
     */
    sellerId: uuid('seller_id')
      .notNull()
      .references(() => sellerProfiles.id, { onDelete: 'restrict' }),
    /** active | ended | cancelled. Ver el CHECK. */
    status: text('status').notNull(),
    /**
     * Multiplicador de comision prometido al promocionar. numeric(6,3), misma
     * escala que `orders.promotion_multiplier_at_transaction`, para que copiar
     * de una a otra no redondee.
     */
    commissionMultiplierSnapshot: numeric('commission_multiplier_snapshot', {
      precision: 6,
      scale: 3,
    }).notNull(),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    /**
     * Instante YA calculado: `starts_at + promotion_duration_days`. ⚙️ La
     * duracion sale del Config Store, nunca de una constante.
     */
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    /** Solo cuando `status = 'cancelled'`. */
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    /**
     * Quien la creo. `users.id` y no `seller_profiles.id`: hoy promociona el
     * vendedor, pero el dia que un admin promocione una publicacion como
     * cortesia no hace falta otra columna.
     */
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    /** "La promocion activa de esta publicacion" y su historial. */
    index('listing_promotions_listing_id_status_idx').on(t.listingId, t.status),
    /** El barrido que pasa `active` → `ended` recorre por vencimiento. */
    index('listing_promotions_ends_at_idx').on(t.endsAt),
    check('listing_promotions_status_check', sql`${t.status} IN ('active', 'ended', 'cancelled')`),
    /** Una promocion que termina antes de empezar es un bug, no un dato. */
    check('listing_promotions_period_check', sql`${t.endsAt} > ${t.startsAt}`),
    /** El multiplicador es lo que agrava la comision: cero o negativo la borraria. */
    check('listing_promotions_multiplier_check', sql`${t.commissionMultiplierSnapshot} > 0`),
  ],
);
