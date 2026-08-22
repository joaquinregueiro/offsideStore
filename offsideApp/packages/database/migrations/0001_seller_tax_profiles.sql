CREATE TYPE "public"."tax_id_type" AS ENUM('CUIT', 'CUIL', 'CDI');--> statement-breakpoint
CREATE TYPE "public"."tax_verification_status" AS ENUM('PENDING', 'VERIFIED', 'REJECTED');--> statement-breakpoint
CREATE TABLE "seller_tax_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seller_id" uuid NOT NULL,
	"tax_id_type" "tax_id_type" NOT NULL,
	"tax_id" text NOT NULL,
	"verification_status" "tax_verification_status" DEFAULT 'PENDING' NOT NULL,
	"source" text,
	"checked_at" timestamp with time zone,
	"tax_condition" text,
	"valid_from" timestamp with time zone DEFAULT now() NOT NULL,
	"valid_to" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "seller_tax_profiles" ADD CONSTRAINT "seller_tax_profiles_seller_id_seller_profiles_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."seller_profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "seller_tax_profiles_current_key" ON "seller_tax_profiles" USING btree ("seller_id") WHERE "seller_tax_profiles"."valid_to" IS NULL;--> statement-breakpoint
CREATE INDEX "seller_tax_profiles_seller_id_idx" ON "seller_tax_profiles" USING btree ("seller_id");--> statement-breakpoint
CREATE INDEX "seller_tax_profiles_verification_status_idx" ON "seller_tax_profiles" USING btree ("verification_status");--> statement-breakpoint
CREATE INDEX "seller_tax_profiles_tax_id_idx" ON "seller_tax_profiles" USING btree ("tax_id");