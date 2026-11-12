CREATE TABLE "ai_usage" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"app_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"partner" text,
	"workspace_external_id" text,
	"app_external_id" text,
	"model" text,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cache_read_tokens" integer DEFAULT 0 NOT NULL,
	"cache_write_tokens" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "ai_usage_app_idx" ON "ai_usage" USING btree ("app_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "ai_usage_organization_idx" ON "ai_usage" USING btree ("organization_id","kind","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "ai_usage_partner_idx" ON "ai_usage" USING btree ("partner","id");--> statement-breakpoint
-- The runs recorded so far, with the same ids, so a partner's cursor into the usage feed carries on where it was.
INSERT INTO "ai_usage" ("id", "organization_id", "app_id", "kind", "partner", "workspace_external_id", "app_external_id", "model", "input_tokens", "output_tokens", "cache_read_tokens", "cache_write_tokens", "created_at")
SELECT r."id", a."organization_id", r."app_id", 'reply', w."partner", w."external_id", p."external_id", r."model", r."input_tokens", r."output_tokens", r."cache_read_tokens", r."cache_write_tokens", r."created_at"
FROM "ai_runs" r
JOIN "apps" a ON a."id" = r."app_id"
LEFT JOIN "partner_workspaces" w ON w."organization_id" = a."organization_id"
LEFT JOIN "partner_apps" p ON p."app_id" = r."app_id" AND p."partner" = w."partner"
WHERE r."input_tokens" + r."output_tokens" + r."cache_read_tokens" + r."cache_write_tokens" > 0;
