-- =============================================================================
-- Offside Store — migracion inicial
-- Fuente de verdad: ERD v1.1 (docs/04-technical/database-design.md)
-- =============================================================================
-- Las extensiones van PRIMERO: Drizzle Kit no las genera (ERD §1.b).
--   citext   -> users.email (§5.1)
--   unaccent -> busqueda en español (§19.2)
--   pg_trgm  -> indices GIN trigram de listings (§9.1)
--
-- IF NOT EXISTS hace idempotentes SOLO las extensiones. El resto de la
-- migracion no lo es: se aplica una unica vez sobre una base vacia.
-- No contiene ninguna operacion destructiva.
-- =============================================================================
CREATE EXTENSION IF NOT EXISTS "citext";--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS "unaccent";--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS "pg_trgm";--> statement-breakpoint
CREATE TYPE "public"."actor_type" AS ENUM('user', 'seller', 'admin', 'system');--> statement-breakpoint
CREATE TYPE "public"."admin_role" AS ENUM('SUPER_ADMIN', 'ADMIN', 'MODERATOR', 'SUPPORT', 'FINANCE');--> statement-breakpoint
CREATE TYPE "public"."authenticity" AS ENUM('NO_ESPECIFICADA', 'ORIGINAL_DECLARADA', 'REPLICA_OFICIAL', 'VERIFICADA', 'SOSPECHOSA', 'FALSIFICACION');--> statement-breakpoint
CREATE TYPE "public"."catalog_request_status" AS ENUM('PENDING', 'APPROVED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."catalog_target_type" AS ENUM('club', 'national_team', 'brand', 'competition', 'country', 'season', 'size_chart');--> statement-breakpoint
CREATE TYPE "public"."config_scope" AS ENUM('global', 'seller_tier', 'category');--> statement-breakpoint
CREATE TYPE "public"."dispute_reason" AS ENUM('not_received', 'different_from_listing', 'counterfeit', 'condition_mismatch', 'size_mismatch', 'damaged', 'wrong_description', 'other');--> statement-breakpoint
CREATE TYPE "public"."dispute_resolution" AS ENUM('no_action', 'partial_refund', 'full_refund', 'return_required', 'seller_penalty', 'seller_suspended');--> statement-breakpoint
CREATE TYPE "public"."dispute_status" AS ENUM('OPEN', 'WAITING_SELLER', 'UNDER_REVIEW', 'RESOLVED');--> statement-breakpoint
CREATE TYPE "public"."evidence_uploader" AS ENUM('buyer', 'seller', 'admin');--> statement-breakpoint
CREATE TYPE "public"."garment_category" AS ENUM('camiseta', 'short', 'buzo', 'campera', 'conjunto', 'entrenamiento');--> statement-breakpoint
CREATE TYPE "public"."history_event_type" AS ENUM('USER_REGISTERED', 'PURCHASE_COMPLETED', 'SALE_COMPLETED', 'ORDER_CANCELLED', 'DISPUTE_OPENED', 'DISPUTE_RESOLVED', 'REFUND_CREATED', 'REFUND_COMPLETED', 'REVIEW_RECEIVED', 'POLICY_VIOLATION_CONFIRMED', 'ACCOUNT_SUSPENDED');--> statement-breakpoint
CREATE TYPE "public"."identity_status" AS ENUM('unverified', 'pending', 'verified', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."item_condition" AS ENUM('NUEVO', 'COMO_NUEVO', 'EXCELENTE', 'MUY_BUENO', 'BUENO', 'ACEPTABLE');--> statement-breakpoint
CREATE TYPE "public"."kit_type" AS ENUM('home', 'away', 'third', 'goalkeeper', 'special');--> statement-breakpoint
CREATE TYPE "public"."listing_status" AS ENUM('draft', 'active', 'paused', 'sold_out', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."moderation_status" AS ENUM('PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED');--> statement-breakpoint
CREATE TYPE "public"."mp_connection_status" AS ENUM('connected', 'expired', 'revoked', 'disconnected');--> statement-breakpoint
CREATE TYPE "public"."notification_type" AS ENUM('order', 'payment', 'shipment', 'dispute', 'price_alert', 'system');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('PENDING_PAYMENT', 'PAID', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'COMPLETED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('PENDING', 'IN_PROCESS', 'APPROVED', 'REJECTED', 'CANCELLED', 'REFUNDED', 'PARTIALLY_REFUNDED', 'CHARGED_BACK');--> statement-breakpoint
CREATE TYPE "public"."refund_status" AS ENUM('REQUESTED', 'UNDER_REVIEW', 'APPROVED', 'PROCESSING', 'COMPLETED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."refund_type" AS ENUM('FULL', 'PARTIAL');--> statement-breakpoint
CREATE TYPE "public"."risk_level" AS ENUM('NORMAL', 'RIESGO', 'RESTRINGIDO', 'SUSPENDIDO');--> statement-breakpoint
CREATE TYPE "public"."risk_severity" AS ENUM('LOW', 'MEDIUM', 'HIGH');--> statement-breakpoint
CREATE TYPE "public"."risk_source" AS ENUM('SYSTEM', 'ADMIN');--> statement-breakpoint
CREATE TYPE "public"."risk_type" AS ENUM('HIGH_CANCELLATION_RATE', 'EXCESSIVE_DISPUTES', 'CONFIRMED_COUNTERFEIT', 'UNUSUAL_ACTIVITY', 'MULTIPLE_ACCOUNTS', 'CHARGEBACK_PATTERN');--> statement-breakpoint
CREATE TYPE "public"."sanction_type" AS ENUM('warning', 'limitation', 'suspension', 'expulsion', 'penalty');--> statement-breakpoint
CREATE TYPE "public"."seller_liability_status" AS ENUM('OPEN', 'PARTIALLY_SETTLED', 'SETTLED', 'WRITTEN_OFF');--> statement-breakpoint
CREATE TYPE "public"."seller_status" AS ENUM('pending', 'approved', 'limited', 'suspended', 'expelled');--> statement-breakpoint
CREATE TYPE "public"."shipment_status" AS ENUM('created', 'dispatched', 'in_transit', 'delivered', 'delivery_issue', 'returned');--> statement-breakpoint
CREATE TYPE "public"."sleeve" AS ENUM('short', 'long');--> statement-breakpoint
CREATE TYPE "public"."user_level" AS ENUM('NUEVO', 'CONFIABLE', 'DESTACADO', 'COLECCIONISTA', 'TIENDA');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('active', 'suspended', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."version_type" AS ENUM('player', 'fan', 'match_worn', 'other');--> statement-breakpoint
CREATE TABLE "email_verification_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_account_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "password_reset_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"user_agent" text,
	"ip" "inet",
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" "citext" NOT NULL,
	"password_hash" text,
	"email_verified_at" timestamp with time zone,
	"phone" text,
	"phone_verified_at" timestamp with time zone,
	"display_name" text,
	"username" text,
	"status" "user_status" DEFAULT 'active' NOT NULL,
	"user_level" "user_level" DEFAULT 'NUEVO' NOT NULL,
	"risk_level" "risk_level" DEFAULT 'NORMAL' NOT NULL,
	"admin_role" "admin_role",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "identity_verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"status" "identity_status" DEFAULT 'unverified' NOT NULL,
	"method" text,
	"data" jsonb,
	"reviewed_by" uuid,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_addresses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"label" text,
	"recipient_name" text NOT NULL,
	"phone" text,
	"street" text NOT NULL,
	"number" text,
	"apartment" text,
	"city" text NOT NULL,
	"province" text NOT NULL,
	"postal_code" text NOT NULL,
	"country_id" uuid NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_history_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"event_type" "history_event_type" NOT NULL,
	"role" text,
	"ref_entity_type" text,
	"ref_entity_id" uuid,
	"data" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_level_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"from_value" "user_level",
	"to_value" "user_level" NOT NULL,
	"reason" text,
	"triggered_by" "actor_type" NOT NULL,
	"admin_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_risk_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"from_value" "risk_level",
	"to_value" "risk_level" NOT NULL,
	"reason" text,
	"triggered_by" "actor_type" NOT NULL,
	"admin_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mercadopago_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seller_id" uuid NOT NULL,
	"mp_user_id" text NOT NULL,
	"access_token_encrypted" text,
	"refresh_token_encrypted" text,
	"token_expires_at" timestamp with time zone,
	"scopes" text[],
	"public_key" text,
	"status" "mp_connection_status" DEFAULT 'disconnected' NOT NULL,
	"connected_at" timestamp with time zone,
	"last_refreshed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "seller_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"seller_tier_id" uuid,
	"display_name" text NOT NULL,
	"bio" text,
	"status" "seller_status" DEFAULT 'pending' NOT NULL,
	"dispatch_location" jsonb,
	"shipping_policy" text,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "seller_reputations" (
	"seller_id" uuid PRIMARY KEY NOT NULL,
	"sales_count" integer DEFAULT 0 NOT NULL,
	"cancellations_count" integer DEFAULT 0 NOT NULL,
	"claims_count" integer DEFAULT 0 NOT NULL,
	"refunds_count" integer DEFAULT 0 NOT NULL,
	"avg_dispatch_hours" numeric(8, 2),
	"rating_avg" numeric(3, 2),
	"rating_count" integer DEFAULT 0 NOT NULL,
	"counterfeit_flags" integer DEFAULT 0 NOT NULL,
	"score" numeric(6, 2),
	"computed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "seller_tiers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"commission_rate" numeric(6, 4),
	"limits" jsonb,
	"benefits" jsonb,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "brands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"aliases" text[],
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "catalog_change_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"target_type" "catalog_target_type" NOT NULL,
	"payload" jsonb NOT NULL,
	"requested_by" uuid NOT NULL,
	"status" "catalog_request_status" DEFAULT 'PENDING' NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"review_note" text,
	"created_entity_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"aliases" text[],
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"code" "garment_category" NOT NULL,
	"required_attributes" jsonb
);
--> statement-breakpoint
CREATE TABLE "clubs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"aliases" text[],
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "competitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"aliases" text[],
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "countries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"aliases" text[],
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"iso_code" char(2) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "national_teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"aliases" text[],
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "seasons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"aliases" text[],
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"label" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "size_charts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"aliases" text[],
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "listing_images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"listing_id" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"url" text,
	"variants" jsonb,
	"position" integer NOT NULL,
	"alt" text,
	"hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "listing_price_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"listing_id" uuid NOT NULL,
	"old_price_amount" bigint,
	"new_price_amount" bigint NOT NULL,
	"currency" char(3) DEFAULT 'ARS' NOT NULL,
	"changed_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "listings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seller_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"sku" text,
	"status" "listing_status" DEFAULT 'draft' NOT NULL,
	"moderation_status" "moderation_status" DEFAULT 'PENDING' NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"price_amount" bigint NOT NULL,
	"currency" char(3) DEFAULT 'ARS' NOT NULL,
	"stock" integer DEFAULT 1 NOT NULL,
	"club_id" uuid,
	"national_team_id" uuid,
	"brand_id" uuid,
	"competition_id" uuid,
	"country_id" uuid,
	"season_id" uuid,
	"year" integer,
	"model" text,
	"version" "version_type",
	"kit_type" "kit_type",
	"sleeve" "sleeve",
	"player_name" text,
	"player_number" integer,
	"sponsor" text,
	"size_value" text NOT NULL,
	"measurements" jsonb,
	"condition" "item_condition" NOT NULL,
	"authenticity" "authenticity" DEFAULT 'NO_ESPECIFICADA' NOT NULL,
	"is_retro" boolean DEFAULT false NOT NULL,
	"search_vector" "tsvector",
	"extra_attributes" jsonb,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "listings_stock_check" CHECK ("listings"."stock" >= 0),
	CONSTRAINT "listings_price_amount_check" CHECK ("listings"."price_amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "cart_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cart_id" uuid NOT NULL,
	"listing_id" uuid NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"unit_price_snapshot" bigint NOT NULL,
	"currency" char(3) DEFAULT 'ARS' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "carts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "favorites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"listing_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"listing_id" uuid NOT NULL,
	"title_snapshot" text NOT NULL,
	"attributes_snapshot" jsonb,
	"unit_price_amount" bigint NOT NULL,
	"currency" char(3) DEFAULT 'ARS' NOT NULL,
	"quantity" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_status_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"from_status" "order_status",
	"to_status" "order_status" NOT NULL,
	"actor_type" "actor_type" NOT NULL,
	"actor_id" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_number" text NOT NULL,
	"buyer_id" uuid NOT NULL,
	"seller_id" uuid NOT NULL,
	"status" "order_status" DEFAULT 'PENDING_PAYMENT' NOT NULL,
	"currency" char(3) DEFAULT 'ARS' NOT NULL,
	"product_amount" bigint NOT NULL,
	"discount_amount" bigint DEFAULT 0 NOT NULL,
	"shipping_amount" bigint DEFAULT 0 NOT NULL,
	"total_amount" bigint NOT NULL,
	"commission_rate_at_transaction" numeric(6, 4),
	"commission_amount" bigint,
	"mp_fee_amount" bigint,
	"seller_amount" bigint,
	"offside_amount" bigint,
	"seller_tier_code_at_transaction" text,
	"shipping_address" jsonb NOT NULL,
	"payment_deadline" timestamp with time zone,
	"buyer_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"paid_at" timestamp with time zone,
	"shipped_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	CONSTRAINT "orders_total_amount_check" CHECK ("orders"."total_amount" = "orders"."product_amount" - "orders"."discount_amount" + "orders"."shipping_amount"),
	CONSTRAINT "orders_amounts_non_negative_check" CHECK ("orders"."product_amount" >= 0 AND "orders"."discount_amount" >= 0 AND "orders"."shipping_amount" >= 0 AND "orders"."total_amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "chargebacks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"payment_id" uuid NOT NULL,
	"mp_chargeback_id" text,
	"status" text,
	"amount" bigint NOT NULL,
	"currency" char(3) DEFAULT 'ARS' NOT NULL,
	"evidence" jsonb,
	"raw" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "payment_splits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_id" uuid NOT NULL,
	"seller_amount" bigint NOT NULL,
	"marketplace_fee_amount" bigint NOT NULL,
	"mp_fee_amount" bigint,
	"currency" char(3) DEFAULT 'ARS' NOT NULL,
	"raw" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"event_type" text NOT NULL,
	"resource_id" text,
	"idempotency_key" text NOT NULL,
	"signature_valid" boolean,
	"payload" jsonb,
	"processed" boolean DEFAULT false NOT NULL,
	"processed_at" timestamp with time zone,
	"error" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"mp_payment_id" text,
	"status" "payment_status" DEFAULT 'PENDING' NOT NULL,
	"mp_status" text,
	"mp_status_detail" text,
	"idempotency_key" text,
	"payment_method" text,
	"installments" integer,
	"amount" bigint NOT NULL,
	"currency" char(3) DEFAULT 'ARS' NOT NULL,
	"checkout_type" text NOT NULL,
	"raw" jsonb,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "reconciliation_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"source" text,
	"summary" jsonb,
	"discrepancies" jsonb,
	"status" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "refunds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"payment_id" uuid NOT NULL,
	"dispute_id" uuid,
	"type" "refund_type" NOT NULL,
	"status" "refund_status" DEFAULT 'REQUESTED' NOT NULL,
	"amount" bigint NOT NULL,
	"currency" char(3) DEFAULT 'ARS' NOT NULL,
	"seller_portion_amount" bigint,
	"marketplace_portion_amount" bigint,
	"seller_portion_recovered" boolean DEFAULT false NOT NULL,
	"mp_refund_id" text,
	"reason" text,
	"raw" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "seller_liabilities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seller_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"refund_id" uuid,
	"chargeback_id" uuid,
	"amount" bigint NOT NULL,
	"settled_amount" bigint DEFAULT 0 NOT NULL,
	"currency" char(3) DEFAULT 'ARS' NOT NULL,
	"status" "seller_liability_status" DEFAULT 'OPEN' NOT NULL,
	"reason" text,
	"admin_decision" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "seller_liabilities_settled_amount_check" CHECK ("seller_liabilities"."settled_amount" >= 0 AND "seller_liabilities"."settled_amount" <= "seller_liabilities"."amount")
);
--> statement-breakpoint
CREATE TABLE "shipment_tracking_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shipment_id" uuid NOT NULL,
	"status" "shipment_status" NOT NULL,
	"provider_status" text,
	"description" text,
	"occurred_at" timestamp with time zone,
	"raw" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shipments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"provider" text,
	"status" "shipment_status" DEFAULT 'created' NOT NULL,
	"tracking_number" text,
	"label_ref" text,
	"origin" jsonb,
	"destination" jsonb,
	"package_info" jsonb,
	"cost_amount" bigint,
	"currency" char(3) DEFAULT 'ARS' NOT NULL,
	"raw" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dispatched_at" timestamp with time zone,
	"delivered_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "dispute_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dispute_id" uuid NOT NULL,
	"action" "dispute_resolution" NOT NULL,
	"amount" bigint,
	"currency" char(3) DEFAULT 'ARS' NOT NULL,
	"decided_by" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dispute_evidences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dispute_id" uuid NOT NULL,
	"uploaded_by" "evidence_uploader" NOT NULL,
	"uploader_id" uuid,
	"type" text,
	"storage_key" text,
	"url" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "disputes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"buyer_id" uuid NOT NULL,
	"seller_id" uuid NOT NULL,
	"reason" "dispute_reason" NOT NULL,
	"status" "dispute_status" DEFAULT 'OPEN' NOT NULL,
	"resolution" "dispute_resolution",
	"refunded_amount" bigint,
	"currency" char(3) DEFAULT 'ARS' NOT NULL,
	"opened_at" timestamp with time zone,
	"seller_response_due_at" timestamp with time zone,
	"seller_responded_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"rater_id" uuid NOT NULL,
	"seller_id" uuid NOT NULL,
	"rating" integer NOT NULL,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reviews_rating_check" CHECK ("reviews"."rating" >= 1 AND "reviews"."rating" <= 5)
);
--> statement-breakpoint
CREATE TABLE "risk_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"risk_type" "risk_type" NOT NULL,
	"severity" "risk_severity" NOT NULL,
	"source" "risk_source" NOT NULL,
	"reference_type" text,
	"reference_id" uuid,
	"source_history_event_id" uuid,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sanctions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seller_id" uuid NOT NULL,
	"type" "sanction_type" NOT NULL,
	"reason" text,
	"dispute_id" uuid,
	"limitations" jsonb,
	"applied_by" uuid,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"status" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope" "config_scope" DEFAULT 'global' NOT NULL,
	"scope_id" uuid,
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	"value_type" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" "notification_type" NOT NULL,
	"title" text,
	"body" text,
	"payload" jsonb,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_type" "actor_type" NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid,
	"before" jsonb,
	"after" jsonb,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "email_verification_tokens" ADD CONSTRAINT "email_verification_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_accounts" ADD CONSTRAINT "oauth_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_verifications" ADD CONSTRAINT "identity_verifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_verifications" ADD CONSTRAINT "identity_verifications_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_addresses" ADD CONSTRAINT "user_addresses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_addresses" ADD CONSTRAINT "user_addresses_country_id_countries_id_fk" FOREIGN KEY ("country_id") REFERENCES "public"."countries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_history_events" ADD CONSTRAINT "user_history_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_level_history" ADD CONSTRAINT "user_level_history_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_level_history" ADD CONSTRAINT "user_level_history_admin_id_users_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_risk_history" ADD CONSTRAINT "user_risk_history_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_risk_history" ADD CONSTRAINT "user_risk_history_admin_id_users_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mercadopago_accounts" ADD CONSTRAINT "mercadopago_accounts_seller_id_seller_profiles_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."seller_profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seller_profiles" ADD CONSTRAINT "seller_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seller_profiles" ADD CONSTRAINT "seller_profiles_seller_tier_id_seller_tiers_id_fk" FOREIGN KEY ("seller_tier_id") REFERENCES "public"."seller_tiers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seller_reputations" ADD CONSTRAINT "seller_reputations_seller_id_seller_profiles_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."seller_profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_change_requests" ADD CONSTRAINT "catalog_change_requests_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_change_requests" ADD CONSTRAINT "catalog_change_requests_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing_images" ADD CONSTRAINT "listing_images_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing_price_history" ADD CONSTRAINT "listing_price_history_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing_price_history" ADD CONSTRAINT "listing_price_history_changed_by_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listings" ADD CONSTRAINT "listings_seller_id_seller_profiles_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."seller_profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listings" ADD CONSTRAINT "listings_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listings" ADD CONSTRAINT "listings_club_id_clubs_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."clubs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listings" ADD CONSTRAINT "listings_national_team_id_national_teams_id_fk" FOREIGN KEY ("national_team_id") REFERENCES "public"."national_teams"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listings" ADD CONSTRAINT "listings_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listings" ADD CONSTRAINT "listings_competition_id_competitions_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competitions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listings" ADD CONSTRAINT "listings_country_id_countries_id_fk" FOREIGN KEY ("country_id") REFERENCES "public"."countries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listings" ADD CONSTRAINT "listings_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_cart_id_carts_id_fk" FOREIGN KEY ("cart_id") REFERENCES "public"."carts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carts" ADD CONSTRAINT "carts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "favorites" ADD CONSTRAINT "favorites_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "favorites" ADD CONSTRAINT "favorites_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_status_history" ADD CONSTRAINT "order_status_history_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_status_history" ADD CONSTRAINT "order_status_history_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_buyer_id_users_id_fk" FOREIGN KEY ("buyer_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_seller_id_seller_profiles_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."seller_profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chargebacks" ADD CONSTRAINT "chargebacks_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chargebacks" ADD CONSTRAINT "chargebacks_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_splits" ADD CONSTRAINT "payment_splits_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_records" ADD CONSTRAINT "reconciliation_records_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_dispute_id_disputes_id_fk" FOREIGN KEY ("dispute_id") REFERENCES "public"."disputes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seller_liabilities" ADD CONSTRAINT "seller_liabilities_seller_id_seller_profiles_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."seller_profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seller_liabilities" ADD CONSTRAINT "seller_liabilities_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seller_liabilities" ADD CONSTRAINT "seller_liabilities_refund_id_refunds_id_fk" FOREIGN KEY ("refund_id") REFERENCES "public"."refunds"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seller_liabilities" ADD CONSTRAINT "seller_liabilities_chargeback_id_chargebacks_id_fk" FOREIGN KEY ("chargeback_id") REFERENCES "public"."chargebacks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_tracking_events" ADD CONSTRAINT "shipment_tracking_events_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispute_actions" ADD CONSTRAINT "dispute_actions_dispute_id_disputes_id_fk" FOREIGN KEY ("dispute_id") REFERENCES "public"."disputes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispute_actions" ADD CONSTRAINT "dispute_actions_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispute_evidences" ADD CONSTRAINT "dispute_evidences_dispute_id_disputes_id_fk" FOREIGN KEY ("dispute_id") REFERENCES "public"."disputes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispute_evidences" ADD CONSTRAINT "dispute_evidences_uploader_id_users_id_fk" FOREIGN KEY ("uploader_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_buyer_id_users_id_fk" FOREIGN KEY ("buyer_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_seller_id_seller_profiles_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."seller_profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_rater_id_users_id_fk" FOREIGN KEY ("rater_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_seller_id_seller_profiles_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."seller_profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_events" ADD CONSTRAINT "risk_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_events" ADD CONSTRAINT "risk_events_source_history_event_id_user_history_events_id_fk" FOREIGN KEY ("source_history_event_id") REFERENCES "public"."user_history_events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sanctions" ADD CONSTRAINT "sanctions_seller_id_seller_profiles_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."seller_profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sanctions" ADD CONSTRAINT "sanctions_dispute_id_disputes_id_fk" FOREIGN KEY ("dispute_id") REFERENCES "public"."disputes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sanctions" ADD CONSTRAINT "sanctions_applied_by_users_id_fk" FOREIGN KEY ("applied_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "email_verification_tokens_token_hash_key" ON "email_verification_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "email_verification_tokens_user_id_idx" ON "email_verification_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "oauth_accounts_provider_account_key" ON "oauth_accounts" USING btree ("provider","provider_account_id");--> statement-breakpoint
CREATE INDEX "oauth_accounts_user_id_idx" ON "oauth_accounts" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "password_reset_tokens_token_hash_key" ON "password_reset_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "password_reset_tokens_user_id_idx" ON "password_reset_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expires_at_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_key" ON "users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "users_username_key" ON "users" USING btree ("username") WHERE "users"."username" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "users_status_idx" ON "users" USING btree ("status");--> statement-breakpoint
CREATE INDEX "users_user_level_idx" ON "users" USING btree ("user_level");--> statement-breakpoint
CREATE INDEX "users_risk_level_idx" ON "users" USING btree ("risk_level");--> statement-breakpoint
CREATE INDEX "users_admin_role_idx" ON "users" USING btree ("admin_role") WHERE "users"."admin_role" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "identity_verifications_user_id_idx" ON "identity_verifications" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "identity_verifications_status_idx" ON "identity_verifications" USING btree ("status");--> statement-breakpoint
CREATE INDEX "user_addresses_user_id_idx" ON "user_addresses" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_history_events_user_id_created_at_idx" ON "user_history_events" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "user_history_events_event_type_idx" ON "user_history_events" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "user_history_events_ref_entity_idx" ON "user_history_events" USING btree ("ref_entity_type","ref_entity_id");--> statement-breakpoint
CREATE INDEX "user_level_history_user_id_created_at_idx" ON "user_level_history" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "user_risk_history_user_id_created_at_idx" ON "user_risk_history" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "mercadopago_accounts_seller_id_key" ON "mercadopago_accounts" USING btree ("seller_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mercadopago_accounts_mp_user_id_key" ON "mercadopago_accounts" USING btree ("mp_user_id");--> statement-breakpoint
CREATE INDEX "mercadopago_accounts_status_idx" ON "mercadopago_accounts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "mercadopago_accounts_token_expires_at_idx" ON "mercadopago_accounts" USING btree ("token_expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "seller_profiles_user_id_key" ON "seller_profiles" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "seller_profiles_status_idx" ON "seller_profiles" USING btree ("status");--> statement-breakpoint
CREATE INDEX "seller_profiles_seller_tier_id_idx" ON "seller_profiles" USING btree ("seller_tier_id");--> statement-breakpoint
CREATE UNIQUE INDEX "seller_tiers_code_key" ON "seller_tiers" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "brands_slug_key" ON "brands" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "catalog_change_requests_status_idx" ON "catalog_change_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "catalog_change_requests_requested_by_idx" ON "catalog_change_requests" USING btree ("requested_by");--> statement-breakpoint
CREATE INDEX "catalog_change_requests_target_type_idx" ON "catalog_change_requests" USING btree ("target_type");--> statement-breakpoint
CREATE UNIQUE INDEX "categories_slug_key" ON "categories" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "categories_code_key" ON "categories" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "clubs_slug_key" ON "clubs" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "competitions_slug_key" ON "competitions" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "countries_slug_key" ON "countries" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "countries_iso_code_key" ON "countries" USING btree ("iso_code");--> statement-breakpoint
CREATE UNIQUE INDEX "national_teams_slug_key" ON "national_teams" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "seasons_slug_key" ON "seasons" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "seasons_label_key" ON "seasons" USING btree ("label");--> statement-breakpoint
CREATE UNIQUE INDEX "size_charts_slug_key" ON "size_charts" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "listing_images_listing_id_position_key" ON "listing_images" USING btree ("listing_id","position");--> statement-breakpoint
CREATE INDEX "listing_images_listing_id_idx" ON "listing_images" USING btree ("listing_id");--> statement-breakpoint
CREATE INDEX "listing_price_history_listing_id_idx" ON "listing_price_history" USING btree ("listing_id");--> statement-breakpoint
CREATE UNIQUE INDEX "listings_seller_id_sku_key" ON "listings" USING btree ("seller_id","sku") WHERE "listings"."sku" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "listings_seller_id_idx" ON "listings" USING btree ("seller_id");--> statement-breakpoint
CREATE INDEX "listings_status_idx" ON "listings" USING btree ("status");--> statement-breakpoint
CREATE INDEX "listings_moderation_status_idx" ON "listings" USING btree ("moderation_status");--> statement-breakpoint
CREATE INDEX "listings_category_id_idx" ON "listings" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "listings_club_id_idx" ON "listings" USING btree ("club_id");--> statement-breakpoint
CREATE INDEX "listings_national_team_id_idx" ON "listings" USING btree ("national_team_id");--> statement-breakpoint
CREATE INDEX "listings_brand_id_idx" ON "listings" USING btree ("brand_id");--> statement-breakpoint
CREATE INDEX "listings_competition_id_idx" ON "listings" USING btree ("competition_id");--> statement-breakpoint
CREATE INDEX "listings_season_id_idx" ON "listings" USING btree ("season_id");--> statement-breakpoint
CREATE INDEX "listings_price_amount_idx" ON "listings" USING btree ("price_amount");--> statement-breakpoint
CREATE INDEX "listings_condition_idx" ON "listings" USING btree ("condition");--> statement-breakpoint
CREATE INDEX "listings_authenticity_idx" ON "listings" USING btree ("authenticity");--> statement-breakpoint
CREATE INDEX "listings_is_retro_idx" ON "listings" USING btree ("is_retro");--> statement-breakpoint
CREATE INDEX "listings_search_vector_idx" ON "listings" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "listings_extra_attributes_idx" ON "listings" USING gin ("extra_attributes");--> statement-breakpoint
CREATE INDEX "listings_title_trgm_idx" ON "listings" USING gin ("title" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "listings_player_name_trgm_idx" ON "listings" USING gin ("player_name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "listings_model_trgm_idx" ON "listings" USING gin ("model" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "listings_status_category_club_idx" ON "listings" USING btree ("status","category_id","club_id");--> statement-breakpoint
CREATE INDEX "listings_status_price_idx" ON "listings" USING btree ("status","price_amount");--> statement-breakpoint
CREATE UNIQUE INDEX "cart_items_cart_id_listing_id_key" ON "cart_items" USING btree ("cart_id","listing_id");--> statement-breakpoint
CREATE INDEX "cart_items_cart_id_idx" ON "cart_items" USING btree ("cart_id");--> statement-breakpoint
CREATE INDEX "cart_items_listing_id_idx" ON "cart_items" USING btree ("listing_id");--> statement-breakpoint
CREATE UNIQUE INDEX "carts_user_id_key" ON "carts" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "favorites_user_id_listing_id_key" ON "favorites" USING btree ("user_id","listing_id");--> statement-breakpoint
CREATE INDEX "favorites_user_id_idx" ON "favorites" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "favorites_listing_id_idx" ON "favorites" USING btree ("listing_id");--> statement-breakpoint
CREATE INDEX "order_items_order_id_idx" ON "order_items" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "order_items_listing_id_idx" ON "order_items" USING btree ("listing_id");--> statement-breakpoint
CREATE INDEX "order_status_history_order_id_idx" ON "order_status_history" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_order_number_key" ON "orders" USING btree ("order_number");--> statement-breakpoint
CREATE INDEX "orders_buyer_id_created_at_idx" ON "orders" USING btree ("buyer_id","created_at");--> statement-breakpoint
CREATE INDEX "orders_seller_id_status_idx" ON "orders" USING btree ("seller_id","status");--> statement-breakpoint
CREATE INDEX "orders_status_idx" ON "orders" USING btree ("status");--> statement-breakpoint
CREATE INDEX "orders_status_payment_deadline_idx" ON "orders" USING btree ("status","payment_deadline");--> statement-breakpoint
CREATE INDEX "chargebacks_order_id_idx" ON "chargebacks" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "chargebacks_payment_id_idx" ON "chargebacks" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX "payment_splits_payment_id_idx" ON "payment_splits" USING btree ("payment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_webhook_events_idempotency_key_key" ON "payment_webhook_events" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "payment_webhook_events_resource_id_idx" ON "payment_webhook_events" USING btree ("resource_id");--> statement-breakpoint
CREATE INDEX "payment_webhook_events_processed_idx" ON "payment_webhook_events" USING btree ("processed");--> statement-breakpoint
CREATE INDEX "payments_order_id_idx" ON "payments" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_mp_payment_id_key" ON "payments" USING btree ("mp_payment_id") WHERE "payments"."mp_payment_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "payments_idempotency_key_key" ON "payments" USING btree ("idempotency_key") WHERE "payments"."idempotency_key" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "payments_status_idx" ON "payments" USING btree ("status");--> statement-breakpoint
CREATE INDEX "refunds_order_id_idx" ON "refunds" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "refunds_payment_id_idx" ON "refunds" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX "refunds_status_idx" ON "refunds" USING btree ("status");--> statement-breakpoint
CREATE INDEX "seller_liabilities_seller_id_idx" ON "seller_liabilities" USING btree ("seller_id");--> statement-breakpoint
CREATE INDEX "seller_liabilities_order_id_idx" ON "seller_liabilities" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "seller_liabilities_status_idx" ON "seller_liabilities" USING btree ("status");--> statement-breakpoint
CREATE INDEX "shipment_tracking_events_shipment_id_idx" ON "shipment_tracking_events" USING btree ("shipment_id");--> statement-breakpoint
CREATE INDEX "shipment_tracking_events_occurred_at_idx" ON "shipment_tracking_events" USING btree ("occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "shipments_order_id_key" ON "shipments" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "shipments_status_idx" ON "shipments" USING btree ("status");--> statement-breakpoint
CREATE INDEX "shipments_tracking_number_idx" ON "shipments" USING btree ("tracking_number");--> statement-breakpoint
CREATE INDEX "dispute_actions_dispute_id_idx" ON "dispute_actions" USING btree ("dispute_id");--> statement-breakpoint
CREATE INDEX "dispute_evidences_dispute_id_idx" ON "dispute_evidences" USING btree ("dispute_id");--> statement-breakpoint
CREATE UNIQUE INDEX "disputes_order_id_key" ON "disputes" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "disputes_status_idx" ON "disputes" USING btree ("status");--> statement-breakpoint
CREATE INDEX "disputes_seller_id_idx" ON "disputes" USING btree ("seller_id");--> statement-breakpoint
CREATE INDEX "disputes_buyer_id_idx" ON "disputes" USING btree ("buyer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reviews_order_id_key" ON "reviews" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "reviews_seller_id_idx" ON "reviews" USING btree ("seller_id");--> statement-breakpoint
CREATE INDEX "risk_events_user_id_created_at_idx" ON "risk_events" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "risk_events_risk_type_idx" ON "risk_events" USING btree ("risk_type");--> statement-breakpoint
CREATE INDEX "risk_events_severity_idx" ON "risk_events" USING btree ("severity");--> statement-breakpoint
CREATE INDEX "risk_events_source_history_event_id_idx" ON "risk_events" USING btree ("source_history_event_id");--> statement-breakpoint
CREATE INDEX "sanctions_seller_id_idx" ON "sanctions" USING btree ("seller_id");--> statement-breakpoint
CREATE INDEX "sanctions_status_idx" ON "sanctions" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "app_settings_scope_key_version_key" ON "app_settings" USING btree ("scope","scope_id","key","version");--> statement-breakpoint
CREATE INDEX "app_settings_scope_key_idx" ON "app_settings" USING btree ("scope","scope_id","key");--> statement-breakpoint
CREATE INDEX "notifications_user_id_idx" ON "notifications" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "notifications_read_at_idx" ON "notifications" USING btree ("read_at");--> statement-breakpoint
CREATE INDEX "audit_log_entity_idx" ON "audit_log" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_log_actor_id_idx" ON "audit_log" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "audit_log_action_idx" ON "audit_log" USING btree ("action");--> statement-breakpoint
CREATE INDEX "audit_log_created_at_idx" ON "audit_log" USING btree ("created_at");