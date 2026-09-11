import { relations } from 'drizzle-orm';

import {
  emailVerificationTokens,
  oauthAccounts,
  passwordResetTokens,
  sessions,
  users,
} from './auth';
import { cartItems, carts, favorites } from './cart';
import {
  brands,
  catalogChangeRequests,
  categories,
  clubs,
  competitions,
  countries,
  nationalTeams,
  seasons,
} from './catalog';
import { appSettings } from './config';
import { disputeActions, disputeEvidences, disputes } from './disputes';
import { listingImages, listingPriceHistory, listings } from './listings';
import { notifications } from './notifications';
import { orderItems, orderStatusHistory, orders } from './orders';
import { chargebacks, paymentSplits, payments, refunds, sellerLiabilities } from './payments';
import { listingPromotions } from './promotions';
import { listingQuestions } from './questions';
import { listingReports } from './reports';
import { reviews } from './reviews';
import {
  mercadopagoAccounts,
  sellerProfiles,
  sellerReputations,
  sellerTaxProfiles,
  sellerTiers,
} from './sellers';
import { shipmentTrackingEvents, shipments } from './shipments';
import { riskEvents, sanctions } from './trust';
import {
  identityVerifications,
  userAddresses,
  userHistoryEvents,
  userLevelHistory,
  userRiskHistory,
} from './users';

/**
 * Relaciones de Drizzle (API `relations`).
 *
 * ⚠️ Esto NO crea foreign keys: las FK reales estan declaradas con
 * `.references()` en cada tabla. `relations` es la capa de consulta que habilita
 * `db.query.x.findMany({ with: { ... } })`.
 *
 * Refleja el diagrama del ERD §4.
 */

export const usersRelations = relations(users, ({ one, many }) => ({
  /** 1:0..1 — un usuario PUEDE ser vendedor. */
  sellerProfile: one(sellerProfiles, {
    fields: [users.id],
    references: [sellerProfiles.userId],
  }),
  addresses: many(userAddresses),
  sessions: many(sessions),
  oauthAccounts: many(oauthAccounts),
  emailVerificationTokens: many(emailVerificationTokens),
  passwordResetTokens: many(passwordResetTokens),
  identityVerifications: many(identityVerifications),
  /** Hechos (fuente de verdad, DEC-036/040). */
  historyEvents: many(userHistoryEvents),
  /** Señales de riesgo (interpretacion, DEC-040). */
  riskEvents: many(riskEvents),
  levelHistory: many(userLevelHistory),
  riskHistory: many(userRiskHistory),
  /** Ordenes donde el usuario es COMPRADOR. */
  orders: many(orders),
  cart: one(carts, { fields: [users.id], references: [carts.userId] }),
  favorites: many(favorites),
  reviewsGiven: many(reviews),
  notifications: many(notifications),
  /** Preguntas que HIZO (no las que respondio: esas van por `answeredBy`). */
  questionsAsked: many(listingQuestions, { relationName: 'question_asker' }),
  /** Denuncias que HIZO (no las que resolvio: esas van por `reviewedBy`). */
  reportsMade: many(listingReports, { relationName: 'report_reporter' }),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
}));

export const oauthAccountsRelations = relations(oauthAccounts, ({ one }) => ({
  user: one(users, { fields: [oauthAccounts.userId], references: [users.id] }),
}));

export const emailVerificationTokensRelations = relations(emailVerificationTokens, ({ one }) => ({
  user: one(users, { fields: [emailVerificationTokens.userId], references: [users.id] }),
}));

export const passwordResetTokensRelations = relations(passwordResetTokens, ({ one }) => ({
  user: one(users, { fields: [passwordResetTokens.userId], references: [users.id] }),
}));

export const userAddressesRelations = relations(userAddresses, ({ one }) => ({
  user: one(users, { fields: [userAddresses.userId], references: [users.id] }),
  country: one(countries, { fields: [userAddresses.countryId], references: [countries.id] }),
}));

export const identityVerificationsRelations = relations(identityVerifications, ({ one }) => ({
  user: one(users, {
    fields: [identityVerifications.userId],
    references: [users.id],
    relationName: 'identity_subject',
  }),
  reviewer: one(users, {
    fields: [identityVerifications.reviewedBy],
    references: [users.id],
    relationName: 'identity_reviewer',
  }),
}));

export const userHistoryEventsRelations = relations(userHistoryEvents, ({ one, many }) => ({
  user: one(users, { fields: [userHistoryEvents.userId], references: [users.id] }),
  /** Señales derivadas de ESTE hecho concreto (puede no haber ninguna). */
  derivedRiskEvents: many(riskEvents),
}));

export const userLevelHistoryRelations = relations(userLevelHistory, ({ one }) => ({
  user: one(users, {
    fields: [userLevelHistory.userId],
    references: [users.id],
    relationName: 'level_history_subject',
  }),
  admin: one(users, {
    fields: [userLevelHistory.adminId],
    references: [users.id],
    relationName: 'level_history_admin',
  }),
}));

export const userRiskHistoryRelations = relations(userRiskHistory, ({ one }) => ({
  user: one(users, {
    fields: [userRiskHistory.userId],
    references: [users.id],
    relationName: 'risk_history_subject',
  }),
  admin: one(users, {
    fields: [userRiskHistory.adminId],
    references: [users.id],
    relationName: 'risk_history_admin',
  }),
}));

export const sellerTiersRelations = relations(sellerTiers, ({ many }) => ({
  sellerProfiles: many(sellerProfiles),
}));

export const sellerProfilesRelations = relations(sellerProfiles, ({ one, many }) => ({
  user: one(users, { fields: [sellerProfiles.userId], references: [users.id] }),
  tier: one(sellerTiers, { fields: [sellerProfiles.sellerTierId], references: [sellerTiers.id] }),
  mercadopagoAccount: one(mercadopagoAccounts, {
    fields: [sellerProfiles.id],
    references: [mercadopagoAccounts.sellerId],
  }),
  /** Cache derivado (DEC-036), no fuente de verdad. */
  reputation: one(sellerReputations, {
    fields: [sellerProfiles.id],
    references: [sellerReputations.sellerId],
  }),
  /** Historial de identidad fiscal; la vigente es la que tiene `valid_to` null. */
  taxProfiles: many(sellerTaxProfiles),
  listings: many(listings),
  /** Historial de promociones del vendedor (delta 2026-09-10). */
  promotions: many(listingPromotions),
  /** Ordenes donde el perfil es VENDEDOR. */
  orders: many(orders),
  liabilities: many(sellerLiabilities),
  sanctions: many(sanctions),
  disputes: many(disputes),
  reviews: many(reviews),
}));

export const mercadopagoAccountsRelations = relations(mercadopagoAccounts, ({ one }) => ({
  seller: one(sellerProfiles, {
    fields: [mercadopagoAccounts.sellerId],
    references: [sellerProfiles.id],
  }),
}));

export const sellerTaxProfilesRelations = relations(sellerTaxProfiles, ({ one }) => ({
  seller: one(sellerProfiles, {
    fields: [sellerTaxProfiles.sellerId],
    references: [sellerProfiles.id],
  }),
}));

export const sellerReputationsRelations = relations(sellerReputations, ({ one }) => ({
  seller: one(sellerProfiles, {
    fields: [sellerReputations.sellerId],
    references: [sellerProfiles.id],
  }),
}));

export const categoriesRelations = relations(categories, ({ many }) => ({
  listings: many(listings),
}));
export const clubsRelations = relations(clubs, ({ many }) => ({ listings: many(listings) }));
export const nationalTeamsRelations = relations(nationalTeams, ({ many }) => ({
  listings: many(listings),
}));
export const brandsRelations = relations(brands, ({ many }) => ({ listings: many(listings) }));
export const competitionsRelations = relations(competitions, ({ many }) => ({
  listings: many(listings),
}));
export const seasonsRelations = relations(seasons, ({ many }) => ({ listings: many(listings) }));
export const countriesRelations = relations(countries, ({ many }) => ({
  listings: many(listings),
  addresses: many(userAddresses),
}));

export const listingsRelations = relations(listings, ({ one, many }) => ({
  seller: one(sellerProfiles, { fields: [listings.sellerId], references: [sellerProfiles.id] }),
  category: one(categories, { fields: [listings.categoryId], references: [categories.id] }),
  club: one(clubs, { fields: [listings.clubId], references: [clubs.id] }),
  nationalTeam: one(nationalTeams, {
    fields: [listings.nationalTeamId],
    references: [nationalTeams.id],
  }),
  brand: one(brands, { fields: [listings.brandId], references: [brands.id] }),
  competition: one(competitions, {
    fields: [listings.competitionId],
    references: [competitions.id],
  }),
  country: one(countries, { fields: [listings.countryId], references: [countries.id] }),
  season: one(seasons, { fields: [listings.seasonId], references: [seasons.id] }),
  images: many(listingImages),
  priceHistory: many(listingPriceHistory),
  orderItems: many(orderItems),
  cartItems: many(cartItems),
  favorites: many(favorites),
  questions: many(listingQuestions),
  /** Historial; `promoted_until` es la proyeccion rapida (delta 2026-09-10). */
  promotions: many(listingPromotions),
  reports: many(listingReports),
}));

/**
 * Delta al ERD v1.3 (owner, 2026-09-10). Dos relaciones con `users` y por eso
 * llevan `relationName`: quien pregunta y quien responde son personas
 * distintas y Drizzle no puede adivinar cual FK es cual.
 */
export const listingQuestionsRelations = relations(listingQuestions, ({ one }) => ({
  listing: one(listings, { fields: [listingQuestions.listingId], references: [listings.id] }),
  asker: one(users, {
    fields: [listingQuestions.askerId],
    references: [users.id],
    relationName: 'question_asker',
  }),
  answeredByUser: one(users, {
    fields: [listingQuestions.answeredBy],
    references: [users.id],
    relationName: 'question_answerer',
  }),
}));

/**
 * Segundo delta al ERD v1.3 (owner, 2026-09-10). Una promocion explica la
 * comision de las ordenes creadas mientras estuvo vigente: de ahi `orders`.
 */
export const listingPromotionsRelations = relations(listingPromotions, ({ one, many }) => ({
  listing: one(listings, { fields: [listingPromotions.listingId], references: [listings.id] }),
  seller: one(sellerProfiles, {
    fields: [listingPromotions.sellerId],
    references: [sellerProfiles.id],
  }),
  createdByUser: one(users, { fields: [listingPromotions.createdBy], references: [users.id] }),
  /** Ordenes que pagaron comision agravada por ESTA promocion. */
  orders: many(orders),
}));

/**
 * Segundo delta al ERD v1.3 (owner, 2026-09-10). Dos relaciones con `users`
 * —quien denuncia y quien resuelve— y por eso llevan `relationName`.
 */
export const listingReportsRelations = relations(listingReports, ({ one }) => ({
  listing: one(listings, { fields: [listingReports.listingId], references: [listings.id] }),
  reporter: one(users, {
    fields: [listingReports.reporterId],
    references: [users.id],
    relationName: 'report_reporter',
  }),
  reviewer: one(users, {
    fields: [listingReports.reviewedBy],
    references: [users.id],
    relationName: 'report_reviewer',
  }),
}));

export const listingImagesRelations = relations(listingImages, ({ one }) => ({
  listing: one(listings, { fields: [listingImages.listingId], references: [listings.id] }),
}));

export const listingPriceHistoryRelations = relations(listingPriceHistory, ({ one }) => ({
  listing: one(listings, { fields: [listingPriceHistory.listingId], references: [listings.id] }),
  changedByUser: one(users, { fields: [listingPriceHistory.changedBy], references: [users.id] }),
}));

export const cartsRelations = relations(carts, ({ one, many }) => ({
  user: one(users, { fields: [carts.userId], references: [users.id] }),
  items: many(cartItems),
}));

export const cartItemsRelations = relations(cartItems, ({ one }) => ({
  cart: one(carts, { fields: [cartItems.cartId], references: [carts.id] }),
  listing: one(listings, { fields: [cartItems.listingId], references: [listings.id] }),
}));

export const favoritesRelations = relations(favorites, ({ one }) => ({
  user: one(users, { fields: [favorites.userId], references: [users.id] }),
  listing: one(listings, { fields: [favorites.listingId], references: [listings.id] }),
}));

export const ordersRelations = relations(orders, ({ one, many }) => ({
  buyer: one(users, { fields: [orders.buyerId], references: [users.id] }),
  seller: one(sellerProfiles, { fields: [orders.sellerId], references: [sellerProfiles.id] }),
  items: many(orderItems),
  statusHistory: many(orderStatusHistory),
  /** Ciclos SEPARADOS (DEC-034): se relacionan por referencia, no por estado. */
  payments: many(payments),
  shipment: one(shipments, { fields: [orders.id], references: [shipments.orderId] }),
  dispute: one(disputes, { fields: [orders.id], references: [disputes.orderId] }),
  refunds: many(refunds),
  chargebacks: many(chargebacks),
  review: one(reviews, { fields: [orders.id], references: [reviews.orderId] }),
  liabilities: many(sellerLiabilities),
  /** Solo cuando `commission_source = 'promoted'` (delta 2026-09-10). */
  listingPromotion: one(listingPromotions, {
    fields: [orders.listingPromotionId],
    references: [listingPromotions.id],
  }),
}));

export const orderItemsRelations = relations(orderItems, ({ one }) => ({
  order: one(orders, { fields: [orderItems.orderId], references: [orders.id] }),
  listing: one(listings, { fields: [orderItems.listingId], references: [listings.id] }),
}));

export const orderStatusHistoryRelations = relations(orderStatusHistory, ({ one }) => ({
  order: one(orders, { fields: [orderStatusHistory.orderId], references: [orders.id] }),
  actor: one(users, { fields: [orderStatusHistory.actorId], references: [users.id] }),
}));

export const paymentsRelations = relations(payments, ({ one, many }) => ({
  order: one(orders, { fields: [payments.orderId], references: [orders.id] }),
  splits: many(paymentSplits),
  refunds: many(refunds),
  chargebacks: many(chargebacks),
}));

export const paymentSplitsRelations = relations(paymentSplits, ({ one }) => ({
  payment: one(payments, { fields: [paymentSplits.paymentId], references: [payments.id] }),
}));

export const refundsRelations = relations(refunds, ({ one, many }) => ({
  order: one(orders, { fields: [refunds.orderId], references: [orders.id] }),
  payment: one(payments, { fields: [refunds.paymentId], references: [payments.id] }),
  dispute: one(disputes, { fields: [refunds.disputeId], references: [disputes.id] }),
  liabilities: many(sellerLiabilities),
}));

export const chargebacksRelations = relations(chargebacks, ({ one, many }) => ({
  order: one(orders, { fields: [chargebacks.orderId], references: [orders.id] }),
  payment: one(payments, { fields: [chargebacks.paymentId], references: [payments.id] }),
  liabilities: many(sellerLiabilities),
}));

export const sellerLiabilitiesRelations = relations(sellerLiabilities, ({ one }) => ({
  seller: one(sellerProfiles, {
    fields: [sellerLiabilities.sellerId],
    references: [sellerProfiles.id],
  }),
  order: one(orders, { fields: [sellerLiabilities.orderId], references: [orders.id] }),
  refund: one(refunds, { fields: [sellerLiabilities.refundId], references: [refunds.id] }),
  chargeback: one(chargebacks, {
    fields: [sellerLiabilities.chargebackId],
    references: [chargebacks.id],
  }),
}));

export const shipmentsRelations = relations(shipments, ({ one, many }) => ({
  order: one(orders, { fields: [shipments.orderId], references: [orders.id] }),
  trackingEvents: many(shipmentTrackingEvents),
}));

export const shipmentTrackingEventsRelations = relations(shipmentTrackingEvents, ({ one }) => ({
  shipment: one(shipments, {
    fields: [shipmentTrackingEvents.shipmentId],
    references: [shipments.id],
  }),
}));

export const disputesRelations = relations(disputes, ({ one, many }) => ({
  order: one(orders, { fields: [disputes.orderId], references: [orders.id] }),
  buyer: one(users, { fields: [disputes.buyerId], references: [users.id] }),
  seller: one(sellerProfiles, { fields: [disputes.sellerId], references: [sellerProfiles.id] }),
  evidences: many(disputeEvidences),
  actions: many(disputeActions),
  refunds: many(refunds),
  sanctions: many(sanctions),
}));

export const disputeEvidencesRelations = relations(disputeEvidences, ({ one }) => ({
  dispute: one(disputes, { fields: [disputeEvidences.disputeId], references: [disputes.id] }),
  uploader: one(users, { fields: [disputeEvidences.uploaderId], references: [users.id] }),
}));

export const disputeActionsRelations = relations(disputeActions, ({ one }) => ({
  dispute: one(disputes, { fields: [disputeActions.disputeId], references: [disputes.id] }),
  decidedByUser: one(users, { fields: [disputeActions.decidedBy], references: [users.id] }),
}));

export const reviewsRelations = relations(reviews, ({ one }) => ({
  order: one(orders, { fields: [reviews.orderId], references: [orders.id] }),
  rater: one(users, { fields: [reviews.raterId], references: [users.id] }),
  seller: one(sellerProfiles, { fields: [reviews.sellerId], references: [sellerProfiles.id] }),
}));

export const riskEventsRelations = relations(riskEvents, ({ one }) => ({
  user: one(users, { fields: [riskEvents.userId], references: [users.id] }),
  /** Nullable a proposito (DEC-040): la señal puede venir de muchos hechos. */
  sourceHistoryEvent: one(userHistoryEvents, {
    fields: [riskEvents.sourceHistoryEventId],
    references: [userHistoryEvents.id],
  }),
}));

export const sanctionsRelations = relations(sanctions, ({ one }) => ({
  seller: one(sellerProfiles, { fields: [sanctions.sellerId], references: [sellerProfiles.id] }),
  dispute: one(disputes, { fields: [sanctions.disputeId], references: [disputes.id] }),
  appliedByUser: one(users, { fields: [sanctions.appliedBy], references: [users.id] }),
}));

export const appSettingsRelations = relations(appSettings, ({ one }) => ({
  updatedByUser: one(users, { fields: [appSettings.updatedBy], references: [users.id] }),
}));

export const notificationsRelations = relations(notifications, ({ one }) => ({
  user: one(users, { fields: [notifications.userId], references: [users.id] }),
}));

/**
 * DEC-041. `created_entity_id` NO tiene relacion declarada: es polimorfica
 * (apunta a clubs/brands/... segun `target_type`) y Drizzle no la modela.
 */
export const catalogChangeRequestsRelations = relations(catalogChangeRequests, ({ one }) => ({
  requester: one(users, {
    fields: [catalogChangeRequests.requestedBy],
    references: [users.id],
    relationName: 'catalog_request_requester',
  }),
  reviewer: one(users, {
    fields: [catalogChangeRequests.reviewedBy],
    references: [users.id],
    relationName: 'catalog_request_reviewer',
  }),
}));
