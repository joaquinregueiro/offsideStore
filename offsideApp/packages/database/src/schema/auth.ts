import { sql } from 'drizzle-orm';
import { index, pgTable, text, timestamp, uniqueIndex, uuid, inet } from 'drizzle-orm/pg-core';

import { citext } from './_custom-types';
import { adminRole, userLevel, riskLevel, userStatus } from './_enums';

/**
 * Modulo AUTH — ERD v1.0 §5.
 * Tablas: users, sessions, oauth_accounts, email_verification_tokens,
 * password_reset_tokens.
 */

/**
 * ERD §5.1 — cuenta base (comprador y/o vendedor).
 *
 * Aloja `user_level` y `risk_level`: aplican al USUARIO, no solo al vendedor
 * (decision Fase 2 §3). El rol vendedor se determina por la existencia de
 * `seller_profiles`, no por una columna.
 */
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** citext: unicidad case-insensitive. Requiere la extension `citext`. */
    email: citext('email').notNull(),
    /** Null si el usuario entra solo por OAuth externo. argon2/bcrypt. */
    passwordHash: text('password_hash'),
    /** Null = no verificado. Sin esto no opera (BR-001). */
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
    phone: text('phone'),
    /** Señal de identidad (DEC-036 / trust-and-safety). */
    phoneVerifiedAt: timestamp('phone_verified_at', { withTimezone: true }),
    displayName: text('display_name'),
    /** Perfil publico. UNIQUE parcial: solo cuando no es null. */
    username: text('username'),
    status: userStatus('status').notNull().default('active'),
    /** DEC-020. Derivado de `user_history_events`; la formula es 🟦 PENDING. */
    userLevel: userLevel('user_level').notNull().default('NUEVO'),
    /** DEC-021. Derivado de historial/`risk_events`; los umbrales son 🟦 PENDING. */
    riskLevel: riskLevel('risk_level').notNull().default('NORMAL'),
    /** DEC-023. Null = no es admin. */
    adminRole: adminRole('admin_role'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }),
    /** Soft delete (eliminacion de cuenta). ERD §20.10. */
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('users_email_key').on(t.email),
    uniqueIndex('users_username_key')
      .on(t.username)
      .where(sql`${t.username} IS NOT NULL`),
    index('users_status_idx').on(t.status),
    index('users_user_level_idx').on(t.userLevel),
    index('users_risk_level_idx').on(t.riskLevel),
    index('users_admin_role_idx')
      .on(t.adminRole)
      .where(sql`${t.adminRole} IS NOT NULL`),
  ],
);

/** ERD §5.2 — sesiones. Efimera: se borra de verdad (ERD §20.10). */
export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Hash del token. NUNCA se guarda el token en plano. */
    tokenHash: text('token_hash').notNull(),
    userAgent: text('user_agent'),
    ip: inet('ip'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('sessions_token_hash_key').on(t.tokenHash),
    index('sessions_user_id_idx').on(t.userId),
    index('sessions_expires_at_idx').on(t.expiresAt),
  ],
);

/**
 * ERD §5.3 — OAuth de LOGIN (Google/Apple).
 *
 * ⚠️ NO es Mercado Pago: la conexion de cobro vive en `mercadopago_accounts`.
 * Conectar MP no es login ni otorga confianza (BR-003).
 */
export const oauthAccounts = pgTable(
  'oauth_accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    providerAccountId: text('provider_account_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('oauth_accounts_provider_account_key').on(t.provider, t.providerAccountId),
    index('oauth_accounts_user_id_idx').on(t.userId),
  ],
);

/** ERD §5.4 — efimera. */
export const emailVerificationTokens = pgTable(
  'email_verification_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('email_verification_tokens_token_hash_key').on(t.tokenHash),
    index('email_verification_tokens_user_id_idx').on(t.userId),
  ],
);

/** ERD §5.5 — efimera. */
export const passwordResetTokens = pgTable(
  'password_reset_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('password_reset_tokens_token_hash_key').on(t.tokenHash),
    index('password_reset_tokens_user_id_idx').on(t.userId),
  ],
);
