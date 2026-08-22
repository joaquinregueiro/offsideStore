import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { notificationType } from './_enums';
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
