CREATE TYPE "public"."email_suppression_reason" AS ENUM('BOUNCE', 'COMPLAINT');--> statement-breakpoint
CREATE TABLE "email_suppressions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" "citext" NOT NULL,
	"reason" "email_suppression_reason" NOT NULL,
	"provider" text DEFAULT 'ses' NOT NULL,
	"provider_subtype" text,
	"provider_message_id" text,
	"raw" jsonb,
	"suppressed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"released_at" timestamp with time zone,
	"released_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "email_suppressions" ADD CONSTRAINT "email_suppressions_released_by_users_id_fk" FOREIGN KEY ("released_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "email_suppressions_email_key" ON "email_suppressions" USING btree ("email");--> statement-breakpoint
CREATE INDEX "email_suppressions_suppressed_at_idx" ON "email_suppressions" USING btree ("suppressed_at");