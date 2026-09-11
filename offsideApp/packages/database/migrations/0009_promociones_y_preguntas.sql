CREATE TABLE "listing_questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"listing_id" uuid NOT NULL,
	"asker_id" uuid NOT NULL,
	"question" text NOT NULL,
	"answer" text,
	"answered_at" timestamp with time zone,
	"answered_by" uuid,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "listing_questions_status_check" CHECK ("listing_questions"."status" IN ('open', 'answered', 'hidden'))
);
--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "promoted_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "promoted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "promotion_multiplier_at_transaction" numeric(6, 3);--> statement-breakpoint
ALTER TABLE "listing_questions" ADD CONSTRAINT "listing_questions_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing_questions" ADD CONSTRAINT "listing_questions_asker_id_users_id_fk" FOREIGN KEY ("asker_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing_questions" ADD CONSTRAINT "listing_questions_answered_by_users_id_fk" FOREIGN KEY ("answered_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "listing_questions_listing_id_idx" ON "listing_questions" USING btree ("listing_id");--> statement-breakpoint
CREATE INDEX "listing_questions_asker_id_idx" ON "listing_questions" USING btree ("asker_id");--> statement-breakpoint
CREATE INDEX "listings_promoted_until_idx" ON "listings" USING btree ("promoted_until") WHERE "listings"."promoted_until" IS NOT NULL;