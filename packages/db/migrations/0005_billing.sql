ALTER TABLE "apps" ADD COLUMN "setup_conversation_id" uuid;--> statement-breakpoint
-- Apps that already have conversations: their first one is the setup conversation.
UPDATE "apps" AS a SET "setup_conversation_id" = (
  SELECT c."id" FROM "conversations" AS c WHERE c."app_id" = a."id" ORDER BY c."created_at", c."id" LIMIT 1
) WHERE a."first_message_at" IS NOT NULL;
