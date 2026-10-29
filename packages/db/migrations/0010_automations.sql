CREATE TABLE "automation_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"automation_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"status" text NOT NULL,
	"reason" text,
	"step_index" integer DEFAULT 0 NOT NULL,
	"next_at" timestamp with time zone,
	"first_sent_at" timestamp with time zone,
	"message_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"open_chat" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "automations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"app_id" uuid NOT NULL,
	"name" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"trigger_event" text NOT NULL,
	"definition" jsonb NOT NULL,
	"sender_user_id" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"app_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_event_id" text,
	"raw_type" text,
	"event" text,
	"status" text NOT NULL,
	"reason" text,
	"environment" text,
	"person" text,
	"product_id" text,
	"device_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_integrations" (
	"app_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"secret_enc" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_event_at" timestamp with time zone,
	CONSTRAINT "provider_integrations_app_id_provider_pk" PRIMARY KEY("app_id","provider")
);
--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "user_engaged" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "subscription" jsonb;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "reported_paying" boolean;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "original_transaction_ids" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_automation_id_automations_id_fk" FOREIGN KEY ("automation_id") REFERENCES "public"."automations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automations" ADD CONSTRAINT "automations_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automations" ADD CONSTRAINT "automations_sender_user_id_users_id_fk" FOREIGN KEY ("sender_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automations" ADD CONSTRAINT "automations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_events" ADD CONSTRAINT "provider_events_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_integrations" ADD CONSTRAINT "provider_integrations_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "automation_runs_automation_device_idx" ON "automation_runs" USING btree ("automation_id","device_id");--> statement-breakpoint
CREATE INDEX "automation_runs_status_idx" ON "automation_runs" USING btree ("automation_id","status","next_at");--> statement-breakpoint
CREATE INDEX "automation_runs_device_idx" ON "automation_runs" USING btree ("device_id");--> statement-breakpoint
CREATE INDEX "automations_trigger_idx" ON "automations" USING btree ("app_id","trigger_event") WHERE "automations"."enabled";--> statement-breakpoint
CREATE UNIQUE INDEX "provider_events_dedupe_uq" ON "provider_events" USING btree ("app_id","provider","provider_event_id") WHERE "provider_events"."provider_event_id" is not null;--> statement-breakpoint
CREATE INDEX "provider_events_app_idx" ON "provider_events" USING btree ("app_id","received_at");--> statement-breakpoint
CREATE INDEX "provider_events_devices_idx" ON "provider_events" USING gin ("device_ids");--> statement-breakpoint
CREATE INDEX "devices_original_transactions_idx" ON "devices" USING gin ("original_transaction_ids");