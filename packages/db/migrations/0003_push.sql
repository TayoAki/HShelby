CREATE TABLE "push_configs" (
	"app_id" uuid PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"key_id" text NOT NULL,
	"p8_enc" text NOT NULL,
	"bundle_id" text NOT NULL,
	"title_template" text NOT NULL,
	"body_template" text NOT NULL,
	"sender_name" text,
	"show_preview" boolean DEFAULT true NOT NULL,
	"sound" boolean DEFAULT true NOT NULL,
	"issue" text,
	"issue_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "push_token" text;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "push_env" text;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "updates_app_badge" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "push_issue" text;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "push_issue_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "push_configs" ADD CONSTRAINT "push_configs_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "devices_app_push_token_idx" ON "devices" USING btree ("app_id","push_token") WHERE "devices"."push_token" is not null;