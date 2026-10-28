CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"app_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"last_seq" bigint DEFAULT 0 NOT NULL,
	"user_read_seq" bigint DEFAULT 0 NOT NULL,
	"team_read_seq" bigint DEFAULT 0 NOT NULL,
	"unread_for_user" integer DEFAULT 0 NOT NULL,
	"unread_for_team" integer DEFAULT 0 NOT NULL,
	"last_message_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"superseded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "devices" (
	"id" uuid PRIMARY KEY NOT NULL,
	"app_id" uuid NOT NULL,
	"secret_hash" text NOT NULL,
	"session_version" integer DEFAULT 1 NOT NULL,
	"model" text,
	"os_version" text,
	"app_version" text,
	"sdk_version" text,
	"locale" text,
	"timezone" text,
	"blocked" boolean DEFAULT false NOT NULL,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "devices_secret_hash_unique" UNIQUE("secret_hash")
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"conversation_id" uuid NOT NULL,
	"seq" bigint NOT NULL,
	"sender" text NOT NULL,
	"source" text NOT NULL,
	"author_user_id" text,
	"device_id" uuid,
	"client_id" text,
	"kind" text DEFAULT 'text' NOT NULL,
	"text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_live_device_uq" ON "conversations" USING btree ("device_id") WHERE "conversations"."superseded_at" is null;--> statement-breakpoint
CREATE INDEX "conversations_inbox_idx" ON "conversations" USING btree ("organization_id","status","last_message_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "conversations_app_idx" ON "conversations" USING btree ("app_id");--> statement-breakpoint
CREATE INDEX "devices_app_idx" ON "devices" USING btree ("app_id");--> statement-breakpoint
CREATE UNIQUE INDEX "messages_conversation_seq_uq" ON "messages" USING btree ("conversation_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "messages_device_client_uq" ON "messages" USING btree ("device_id","client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "messages_author_client_uq" ON "messages" USING btree ("author_user_id","client_id");