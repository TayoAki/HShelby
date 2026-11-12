CREATE TABLE "partner_claims" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"email" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "partner_workspaces" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"partner" text NOT NULL,
	"external_id" text NOT NULL,
	"owner_email" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"ai_allowed" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "partner_apps" DROP CONSTRAINT "partner_apps_organization_id_organizations_id_fk";
--> statement-breakpoint
DROP INDEX "partner_apps_owner_idx";--> statement-breakpoint
ALTER TABLE "partner_apps" DROP CONSTRAINT "partner_apps_partner_external_id_pk";--> statement-breakpoint
ALTER TABLE "partner_apps" ADD PRIMARY KEY ("app_id");--> statement-breakpoint
ALTER TABLE "ai_runs" ADD COLUMN "model" text;--> statement-breakpoint
ALTER TABLE "partner_claims" ADD CONSTRAINT "partner_claims_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_workspaces" ADD CONSTRAINT "partner_workspaces_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "partner_workspaces_external_uq" ON "partner_workspaces" USING btree ("partner","external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "partner_apps_external_uq" ON "partner_apps" USING btree ("partner","external_id");--> statement-breakpoint
ALTER TABLE "partner_apps" DROP COLUMN "organization_id";--> statement-breakpoint
ALTER TABLE "partner_apps" DROP COLUMN "owner_email";--> statement-breakpoint
ALTER TABLE "partner_apps" DROP COLUMN "created_at";