import { bigint, boolean, index, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { apps } from "./apps";
import { organizations } from "./auth";
import { conversations, messages } from "./messaging";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
/** Telegram chat and message IDs fit in 52 bits. */
const tgId = (name: string) => bigint(name, { mode: "number" });

/**
 * A customer's Telegram bot (from BotFather). Telegram allows one webhook per bot, so the webhook is per bot
 * (`/webhooks/telegram/<id>`) and one bot can serve several apps of the workspace.
 */
export const telegramBots = pgTable("telegram_bots", {
  id: uuid("id").primaryKey(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  /** Telegram's numeric bot ID (the token's prefix): a bot belongs to one workspace. */
  telegramBotId: tgId("telegram_bot_id").notNull().unique(),
  username: text("username").notNull(),
  /** The bot token, encrypted with the ENC_KEYS keyring. */
  tokenEnc: text("token_enc").notNull(),
  /** SHA-256 (hex) of the webhook's secret token, which Telegram sends on every update. */
  webhookSecretHash: text("webhook_secret_hash").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

/** Where an app's customer messages go: a private chat, group or supergroup (never a channel). */
export const telegramConnections = pgTable(
  "telegram_connections",
  {
    appId: uuid("app_id")
      .primaryKey()
      .references(() => apps.id, { onDelete: "cascade" }),
    botId: uuid("bot_id")
      .notNull()
      .references(() => telegramBots.id, { onDelete: "cascade" }),
    chatId: tgId("chat_id").notNull(),
    chatTitle: text("chat_title"),
    chatType: text("chat_type", { enum: ["private", "group", "supergroup"] }).notNull(),
    /** Paused: nothing is posted, and what's missed meanwhile isn't replayed. */
    paused: boolean("paused").notNull().default(false),
    /** One forum topic per customer, so no Reply is needed (needs a forum supergroup and "Manage topics"). */
    topics: boolean("topics").notNull().default(false),
    /** The last thing Telegram refused (bot removed, no rights…), shown in the dashboard. */
    issue: text("issue"),
    issueAt: ts("issue_at"),
    connectedAt: ts("connected_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [index("telegram_connections_bot_chat_idx").on(t.botId, t.chatId)],
);

/**
 * The bot's posts and the team's replies in a chat, mapped to the conversation, so a Telegram Reply finds its
 * customer. The key also makes a redelivered update a no-op.
 */
export const telegramPosts = pgTable(
  "telegram_posts",
  {
    botId: uuid("bot_id")
      .notNull()
      .references(() => telegramBots.id, { onDelete: "cascade" }),
    chatId: tgId("chat_id").notNull(),
    telegramMessageId: tgId("telegram_message_id").notNull(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    messageId: uuid("message_id").references(() => messages.id, { onDelete: "cascade" }),
    /** notification: a customer message; mirror: a reply sent from elsewhere; reply: the team's answer in Telegram. */
    kind: text("kind", { enum: ["notification", "mirror", "reply"] }).notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.botId, t.chatId, t.telegramMessageId] }),
    index("telegram_posts_conversation_idx").on(t.conversationId, t.createdAt),
  ],
);

/** Forum topics: one per customer conversation, named "App · User". */
export const telegramTopics = pgTable(
  "telegram_topics",
  {
    botId: uuid("bot_id")
      .notNull()
      .references(() => telegramBots.id, { onDelete: "cascade" }),
    chatId: tgId("chat_id").notNull(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    threadId: tgId("thread_id").notNull(),
    name: text("name").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.botId, t.chatId, t.conversationId] }),
    uniqueIndex("telegram_topics_thread_uq").on(t.botId, t.chatId, t.threadId),
  ],
);

/**
 * Per-chat pacing: Telegram allows about 20 messages a minute in a group. Sends are scheduled at least the
 * interval apart (`next_slot_at`), and each send waits for `last_sent_at` + interval under a row lock.
 */
export const telegramChats = pgTable(
  "telegram_chats",
  {
    botId: uuid("bot_id")
      .notNull()
      .references(() => telegramBots.id, { onDelete: "cascade" }),
    chatId: tgId("chat_id").notNull(),
    nextSlotAt: ts("next_slot_at").notNull().defaultNow(),
    lastSentAt: ts("last_sent_at"),
  },
  (t) => [primaryKey({ columns: [t.botId, t.chatId] })],
);
