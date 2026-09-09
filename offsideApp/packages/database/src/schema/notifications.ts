import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { citext } from './_custom-types';
import { emailSuppressionReason, notificationType } from './_enums';
import { users } from './auth';

/**
 * Modulo NOTIFICATIONS — ERD v1.0 §18.
 * El envio se procesa por BullMQ. Push queda fuera del MVP.
 */
export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: notificationType('type').notNull(),
    title: text('title'),
    body: text('body'),
    payload: jsonb('payload'),
    /** Null = no leida. */
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('notifications_user_id_idx').on(t.userId),
    index('notifications_read_at_idx').on(t.readAt),
  ],
);

/**
 * Direcciones a las que NO se manda mas email.
 *
 * =============================================================================
 * ⚠️ ESTA TABLA NO ESTA EN EL ERD v1.2
 * =============================================================================
 *
 * `database-design.md` §24 lista 51 tablas y ninguna cubre esto: `notifications`
 * (§18) es la campanita in-app —`user_id, type, title, body, read_at`— y no
 * tiene direccion, ni estado de entrega, ni proveedor. El ERD SI modela los
 * webhooks del otro proveedor (`payment_webhook_events`); el equivalente de
 * email nunca se modelo.
 *
 * La tabla la AUTORIZO EL OWNER el 2026-09-08, tras plantearle el bloqueo. Es
 * un cambio ARQUITECTONICO (CLAUDE.md §5) y por eso no se tomo desde el codigo.
 * ⚠️ Falta reflejarlo en `docs/04-technical/database-design.md`, que es solo
 * lectura (§3): hasta que eso pase, el ERD y el schema no coinciden.
 *
 * =============================================================================
 * POR QUE HACE FALTA SI SES YA TIENE SU PROPIA LISTA
 * =============================================================================
 *
 * Porque resuelven cosas distintas. La lista de SES protege la REPUTACION de la
 * cuenta de AWS: deja de entregar y no cuenta esos envios para la tasa de
 * rebote. Pero SES **acepta** el mensaje, asi que del lado de Offside el job
 * termina bien y el log dice "enviado". Nadie se entera de que no llego nunca.
 *
 * El resultado es una CUENTA MUERTA EN SILENCIO: quien se registro con un typo
 * no puede ingresar (BR-001), pide reenvio, el reenvio "sale bien" y no llega
 * nunca. Es el mismo agujero que cerro el reenvio de verificacion, un escalon
 * mas abajo. Esta tabla es lo que permite que alguien pueda VERLO.
 */
export const emailSuppressions = pgTable(
  'email_suppressions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /**
     * citext, igual que `users.email`: la direccion que rebota puede llegar de
     * SES con otra capitalizacion que la que guardamos, y `User@x.com` es la
     * misma casilla que `user@x.com`. Comparar sensible al caso haria que la
     * supresion no encontrara nunca al usuario.
     */
    email: citext('email').notNull(),
    reason: emailSuppressionReason('reason').notNull(),
    /** Proveedor que lo reporto. Hoy siempre `ses`; el puerto admite otros. */
    provider: text('provider').notNull().default('ses'),
    /** Subtipo CRUDO del proveedor (`Permanent/General`, `abuse`, ...). */
    providerSubtype: text('provider_subtype'),
    /** `mail.messageId` de SES. Sirve para rastrear el envio que lo causo. */
    providerMessageId: text('provider_message_id'),
    /**
     * Payload crudo, mismo criterio que DEC-035 con Mercado Pago: se conserva
     * lo que dijo el tercero ademas de nuestra interpretacion. Cuando algo no
     * cierre, la unica forma de saber que paso es el original.
     */
    raw: jsonb('raw'),
    /** Ultima vez que se suprimio. Distinto de `created_at` si hubo recaida. */
    suppressedAt: timestamp('suppressed_at', { withTimezone: true }).notNull().defaultNow(),
    /** Null = supresion VIGENTE. Con valor, la direccion vuelve a recibir. */
    releasedAt: timestamp('released_at', { withTimezone: true }),
    /** Quien la libero. RESTRICT: el registro sobrevive al administrador. */
    releasedBy: uuid('released_by').references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }),
  },
  (t) => [
    /**
     * UNA fila por direccion. Un rebote repetido ACTUALIZA la fila, no agrega
     * otra: SNS reintenta y entrega desordenado, asi que sin esto la tabla se
     * llenaria de duplicados del mismo hecho. Ademas es el indice con el que se
     * consulta antes de cada envio.
     */
    uniqueIndex('email_suppressions_email_key').on(t.email),
    index('email_suppressions_suppressed_at_idx').on(t.suppressedAt),
  ],
);
