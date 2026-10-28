ALTER TABLE "devices" ADD COLUMN "chat_open" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "last_seen_in_chat_at" timestamp with time zone;