CREATE TABLE "listing_promotions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"listing_id" uuid NOT NULL,
	"seller_id" uuid NOT NULL,
	"status" text NOT NULL,
	"commission_multiplier_snapshot" numeric(6, 3) NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"cancelled_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "listing_promotions_status_check" CHECK ("listing_promotions"."status" IN ('active', 'ended', 'cancelled')),
	CONSTRAINT "listing_promotions_period_check" CHECK ("listing_promotions"."ends_at" > "listing_promotions"."starts_at"),
	CONSTRAINT "listing_promotions_multiplier_check" CHECK ("listing_promotions"."commission_multiplier_snapshot" > 0)
);
--> statement-breakpoint
CREATE TABLE "listing_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"listing_id" uuid NOT NULL,
	"reporter_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"note" text,
	"status" text DEFAULT 'open' NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "listing_reports_status_check" CHECK ("listing_reports"."status" IN ('open', 'reviewed', 'dismissed'))
);
--> statement-breakpoint
ALTER TABLE "seller_profiles" ADD COLUMN "vacation_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "shipping_mode" text DEFAULT 'to_agree' NOT NULL;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "shipping_cost_amount" bigint;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "commission_source" text DEFAULT 'default' NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "listing_promotion_id" uuid;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "seller_reply" text;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "seller_replied_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "listing_promotions" ADD CONSTRAINT "listing_promotions_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing_promotions" ADD CONSTRAINT "listing_promotions_seller_id_seller_profiles_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."seller_profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing_promotions" ADD CONSTRAINT "listing_promotions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing_reports" ADD CONSTRAINT "listing_reports_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing_reports" ADD CONSTRAINT "listing_reports_reporter_id_users_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing_reports" ADD CONSTRAINT "listing_reports_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "listing_promotions_listing_id_status_idx" ON "listing_promotions" USING btree ("listing_id","status");--> statement-breakpoint
CREATE INDEX "listing_promotions_ends_at_idx" ON "listing_promotions" USING btree ("ends_at");--> statement-breakpoint
CREATE UNIQUE INDEX "listing_reports_listing_id_reporter_id_key" ON "listing_reports" USING btree ("listing_id","reporter_id");--> statement-breakpoint
CREATE INDEX "listing_reports_status_idx" ON "listing_reports" USING btree ("status");--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_listing_promotion_id_listing_promotions_id_fk" FOREIGN KEY ("listing_promotion_id") REFERENCES "public"."listing_promotions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listings" ADD CONSTRAINT "listings_shipping_mode_check" CHECK ("listings"."shipping_mode" IN ('included', 'buyer_pays', 'to_agree', 'pickup'));--> statement-breakpoint
ALTER TABLE "listings" ADD CONSTRAINT "listings_shipping_cost_amount_check" CHECK ("listings"."shipping_cost_amount" IS NULL OR "listings"."shipping_cost_amount" >= 0);--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_commission_source_check" CHECK ("orders"."commission_source" IN ('default', 'seller_tier', 'promoted'));--> statement-breakpoint
-- =============================================================================
-- SEMILLAS — app_settings (scope global), mismo criterio que 0003–0007 y 0010
-- =============================================================================
--
-- Hasta aca el archivo lo genero drizzle-kit (esquema). Lo que sigue esta
-- escrito a mano y va en la MISMA migracion a proposito: las claves describen
-- las columnas que esta migracion crea (`shipping_mode`, los tiers, las
-- preguntas) y no tiene sentido que exista el esquema sin su configuracion,
-- ni al reves.
--
-- ⚠️ TODOS LOS VALORES SON ASUMIDOS y PENDIENTES DE CONFIRMACION DEL OWNER.
-- Son ⚙️ CONFIGURABLES (DEC-013 / DEC-038): el mecanismo es obligatorio, el
-- valor se cambia desde Admin insertando una version nueva. Nada de esto va
-- como constante en el codigo (CLAUDE.md §12). Los Services validan el valor
-- con `typeof`/Zod, no con `value_type`, que es informativo.
--
-- `value_type`: `string` es el unico tipo nuevo respecto de 0010 (`number`,
-- `json`, `bool`) y hace falta para `shipping_default_mode`. Un jsonb con un
-- string se escribe entre comillas dobles: `'"to_agree"'::jsonb`.
--
-- LOS VALORES, y de donde sale cada uno:
--
--   shipping_default_mode = "to_agree"
--     Modo de envio con el que arranca el formulario de publicar. Coincide con
--     el DEFAULT de `listings.shipping_mode` para que una fila vieja y una
--     nueva sin tocar el campo digan lo mismo. `shipping.md` §5.b deja "quien
--     paga" 🟡: "a convenir" es el unico valor que no decide eso por nadie.
--
--   shipping_pickup_allowed = true
--     Si un vendedor puede ofrecer retiro en persona. `shipping.md` §5.b lo
--     lista como pendiente; se habilita porque sin correo integrado es la
--     unica entrega verificable entre las partes. Apagarlo esconde `pickup`
--     del formulario; las publicaciones que ya lo eligieron no se tocan.
--
--   questions_max_open_per_user = 20
--     Techo de preguntas SIN RESPONDER que una misma cuenta puede tener
--     abiertas a la vez. No es un limite de uso: es el freno para que una
--     cuenta no llene de preguntas a un vendedor —o a todos—.
--
--   questions_max_length = 500
--     Largo maximo de una pregunta y de su respuesta, en caracteres. Es una
--     pregunta sobre una prenda, no un mensaje: mas que eso es el chat que
--     BR-053 marca 🟡.
--
--   favorites_price_drop_min_percent = 10
--     Cuanto tiene que bajar el precio de una publicacion favorita para que
--     valga la pena avisar. Con menos, cada retoque de precio dispara una
--     notificacion y la gente las apaga.
--
--   seller_tier_sales_window_days = 365
--     Ventana hacia atras que cuenta ventas COMPLETED al evaluar el tier
--     (`seller_tier_evaluation`, 0010). Un año: el tier premia volumen
--     sostenido, no una racha de hace tres años.
--
--   seller_tier_auto_assign = true
--     Si el sistema asigna el tier solo al alcanzar el umbral, o si lo asigna
--     una persona desde Admin. Arranca automatico porque no hay pantalla que
--     lo haga a mano; la perilla existe para volver al manual sin redesplegar.
--
--   seller_tier_auto_downgrade = false
--     Si al caer debajo del umbral (por la ventana) el tier BAJA solo. Apagado
--     a proposito: bajar de tier es cobrarle mas a alguien, y eso lo decide
--     una persona hasta que el owner diga lo contrario. Con `auto_assign`
--     encendido y esto apagado, el tier solo sube.
--
--   promoted_first_in_search = true
--     Si las publicaciones promocionadas se muestran ANTES que el resto en
--     busqueda y vitrina (PS-021 ⚙️), o solo suman `promotion_rank_boost` al
--     score. Primero-siempre es lo que el vendedor entiende que compro.
INSERT INTO app_settings (scope, scope_id, key, value, value_type, version)
SELECT 'global', NULL, nuevas.key, nuevas.value::jsonb, nuevas.value_type, 1
FROM (VALUES
  ('shipping_default_mode',             '"to_agree"', 'string'),
  ('shipping_pickup_allowed',           'true',       'bool'),
  ('questions_max_open_per_user',       '20',         'number'),
  ('questions_max_length',              '500',        'number'),
  ('favorites_price_drop_min_percent',  '10',         'number'),
  ('seller_tier_sales_window_days',     '365',        'number'),
  ('seller_tier_auto_assign',           'true',       'bool'),
  ('seller_tier_auto_downgrade',        'false',      'bool'),
  ('promoted_first_in_search',          'true',       'bool')
) AS nuevas(key, value, value_type)
WHERE NOT EXISTS (
  SELECT 1 FROM app_settings
   WHERE app_settings.scope = 'global'
     AND app_settings.scope_id IS NULL
     AND app_settings.key = nuevas.key
);
