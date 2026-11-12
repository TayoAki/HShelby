CREATE TABLE "partner_apps" (
	"partner" text NOT NULL,
	"external_id" text NOT NULL,
	"app_id" uuid NOT NULL,
	"organization_id" text NOT NULL,
	"owner_email" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "partner_apps_partner_external_id_pk" PRIMARY KEY("partner","external_id")
);
--> statement-breakpoint
ALTER TABLE "partner_apps" ADD CONSTRAINT "partner_apps_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_apps" ADD CONSTRAINT "partner_apps_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "partner_apps_owner_idx" ON "partner_apps" USING btree ("partner","owner_email");