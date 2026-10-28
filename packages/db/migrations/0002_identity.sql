ALTER TABLE "apps" ADD COLUMN "only_verified" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "user_id_ext" text;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "name" text;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "email" text;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "verified" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "verified_claims" jsonb;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "signed_out_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "devices_app_user_idx" ON "devices" USING btree ("app_id","user_id_ext");