CREATE TABLE "telegram_bots" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"telegram_bot_id" bigint NOT NULL,
	"username" text NOT NULL,
	"token_enc" text NOT NULL,
	"webhook_secret_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "telegram_bots_telegram_bot_id_unique" UNIQUE("telegram_bot_id")
);
--> statement-breakpoint
CREATE TABLE "telegram_chats" (
	"bot_id" uuid NOT NULL,
	"chat_id" bigint NOT NULL,
	"next_slot_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_sent_at" timestamp with time zone,
	CONSTRAINT "telegram_chats_bot_id_chat_id_pk" PRIMARY KEY("bot_id","chat_id")
);
--> statement-breakpoint
CREATE TABLE "telegram_connections" (
	"app_id" uuid PRIMARY KEY NOT NULL,
	"bot_id" uuid NOT NULL,
	"chat_id" bigint NOT NULL,
	"chat_title" text,
	"chat_type" text NOT NULL,
	"paused" boolean DEFAULT false NOT NULL,
	"topics" boolean DEFAULT false NOT NULL,
	"issue" text,
	"issue_at" timestamp with time zone,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "telegram_posts" (
	"bot_id" uuid NOT NULL,
	"chat_id" bigint NOT NULL,
	"telegram_message_id" bigint NOT NULL,
	"conversation_id" uuid NOT NULL,
	"message_id" uuid,
	"kind" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "telegram_posts_bot_id_chat_id_telegram_message_id_pk" PRIMARY KEY("bot_id","chat_id","telegram_message_id")
);
--> statement-breakpoint
CREATE TABLE "telegram_topics" (
	"bot_id" uuid NOT NULL,
	"chat_id" bigint NOT NULL,
	"conversation_id" uuid NOT NULL,
	"thread_id" bigint NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "telegram_topics_bot_id_chat_id_conversation_id_pk" PRIMARY KEY("bot_id","chat_id","conversation_id")
);
--> statement-breakpoint
ALTER TABLE "telegram_bots" ADD CONSTRAINT "telegram_bots_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_chats" ADD CONSTRAINT "telegram_chats_bot_id_telegram_bots_id_fk" FOREIGN KEY ("bot_id") REFERENCES "public"."telegram_bots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_connections" ADD CONSTRAINT "telegram_connections_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_connections" ADD CONSTRAINT "telegram_connections_bot_id_telegram_bots_id_fk" FOREIGN KEY ("bot_id") REFERENCES "public"."telegram_bots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_posts" ADD CONSTRAINT "telegram_posts_bot_id_telegram_bots_id_fk" FOREIGN KEY ("bot_id") REFERENCES "public"."telegram_bots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_posts" ADD CONSTRAINT "telegram_posts_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_posts" ADD CONSTRAINT "telegram_posts_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_topics" ADD CONSTRAINT "telegram_topics_bot_id_telegram_bots_id_fk" FOREIGN KEY ("bot_id") REFERENCES "public"."telegram_bots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_topics" ADD CONSTRAINT "telegram_topics_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "telegram_connections_bot_chat_idx" ON "telegram_connections" USING btree ("bot_id","chat_id");--> statement-breakpoint
CREATE INDEX "telegram_posts_conversation_idx" ON "telegram_posts" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "telegram_topics_thread_uq" ON "telegram_topics" USING btree ("bot_id","chat_id","thread_id");