CREATE TABLE "beta_access" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"until" timestamp with time zone NOT NULL,
	"note" text,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "beta_invites" (
	"email" text PRIMARY KEY NOT NULL,
	"until" timestamp with time zone NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "beta_access" ADD CONSTRAINT "beta_access_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;