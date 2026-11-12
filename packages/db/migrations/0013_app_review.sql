ALTER TABLE "devices" ADD COLUMN "promotional_push" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "ai_consent" text;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "ai_consent_at" timestamp with time zone;