CREATE TABLE "app_appearance" (
	"app_id" uuid PRIMARY KEY NOT NULL,
	"draft" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"draft_version" integer DEFAULT 0 NOT NULL,
	"draft_asset_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"draft_updated_at" timestamp with time zone,
	"draft_updated_by" text,
	"published" jsonb,
	"published_version" integer DEFAULT 0 NOT NULL,
	"published_asset_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"published_at" timestamp with time zone,
	"published_by" text,
	"reported_local" jsonb,
	"reported_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "assets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"object_key" text NOT NULL,
	"bytes" integer NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assets_object_key_unique" UNIQUE("object_key")
);
--> statement-breakpoint
CREATE TABLE "user_photos" (
	"user_id" text PRIMARY KEY NOT NULL,
	"object_key" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "apps" ADD COLUMN "show_team_photos" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "apps" ADD COLUMN "show_team_names" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "app_appearance" ADD CONSTRAINT "app_appearance_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_appearance" ADD CONSTRAINT "app_appearance_draft_updated_by_users_id_fk" FOREIGN KEY ("draft_updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_appearance" ADD CONSTRAINT "app_appearance_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_photos" ADD CONSTRAINT "user_photos_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "app_appearance_published_assets_idx" ON "app_appearance" USING gin ("published_asset_ids");--> statement-breakpoint
CREATE INDEX "app_appearance_draft_assets_idx" ON "app_appearance" USING gin ("draft_asset_ids");--> statement-breakpoint
CREATE INDEX "assets_org_idx" ON "assets" USING btree ("organization_id","created_at");