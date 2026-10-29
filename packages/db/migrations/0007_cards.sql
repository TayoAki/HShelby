CREATE TABLE "app_paywalls" (
	"app_id" uuid NOT NULL,
	"paywall_id" text NOT NULL,
	"title" text NOT NULL,
	"source" text NOT NULL,
	"presentable" boolean NOT NULL,
	"products" jsonb NOT NULL,
	"first_reported_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_reported_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_paywalls_app_id_paywall_id_pk" PRIMARY KEY("app_id","paywall_id")
);
--> statement-breakpoint
CREATE TABLE "card_settings" (
	"app_id" uuid PRIMARY KEY NOT NULL,
	"review_templates" jsonb NOT NULL,
	"review_button_labels" jsonb NOT NULL,
	"offer_button_labels" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "available_paywalls" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "paywalls_reported_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "review_asked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "card" jsonb;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "action_clicked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app_paywalls" ADD CONSTRAINT "app_paywalls_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_settings" ADD CONSTRAINT "card_settings_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "messages_cards_idx" ON "messages" USING btree ("created_at") WHERE "messages"."kind" <> 'text';