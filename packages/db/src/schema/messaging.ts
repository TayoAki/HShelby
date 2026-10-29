import type { ReportedPaywall, StoredCard } from "@hshelby/contracts";
import { sql } from "drizzle-orm";
import { bigint, boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { apps } from "./apps";
import { organizations, users } from "./auth";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const seq = (name: string) => bigint(name, { mode: "number" });

/**
 * One install of an app, as the SDK registered it. Identity is per device: the same user ID on two
 * devices is two histories. Labels from `identify()` are unverified; a valid identity token sets
 * `verified`, and from then on only another token can change who the device is.
 */
export const devices = pgTable(
  "devices",
  {
    id: uuid("id").primaryKey(),
    appId: uuid("app_id")
      .notNull()
      .references(() => apps.id, { onDelete: "cascade" }),
    /** SHA-256 (hex) of the `dvs_…` secret the SDK keeps in the Keychain; the secret itself is never stored. */
    secretHash: text("secret_hash").notNull().unique(),
    /** Part of every access token; bumping it (logout, delete) invalidates the outstanding ones. */
    sessionVersion: integer("session_version").notNull().default(1),
    model: text("model"),
    osVersion: text("os_version"),
    appVersion: text("app_version"),
    sdkVersion: text("sdk_version"),
    locale: text("locale"),
    timezone: text("timezone"),
    /** The app's own user ID, from identify() or a verified token's `user_id`. */
    userIdExt: text("user_id_ext"),
    name: text("name"),
    email: text("email"),
    verified: boolean("verified").notNull().default(false),
    /** The accepted claims of the latest identity token (never the token itself). */
    verifiedClaims: jsonb("verified_claims").$type<Record<string, unknown>>(),
    verifiedAt: ts("verified_at"),
    /** setMetadata(): up to 20 string entries, replaced as a whole. */
    metadata: jsonb("metadata").$type<Record<string, string>>().notNull().default({}),
    /** Raw APNs device token (hex) and the APNs environment it belongs to. */
    pushToken: text("push_token"),
    pushEnv: text("push_env", { enum: ["sandbox", "production"] }),
    /** Whether pushes set the app icon badge (false when the host app owns its badge). */
    updatesAppBadge: boolean("updates_app_badge").notNull().default(true),
    /** The last APNs rejection for this device, shown in the dashboard; cleared by a delivery or a new token. */
    pushIssue: text("push_issue"),
    pushIssueAt: ts("push_issue_at"),
    blocked: boolean("blocked").notNull().default(false),
    lastSeenAt: ts("last_seen_at"),
    /**
     * "In chat" (phase B6): the SDK has a live socket open while the chat is on screen. `chatOpen` flips on
     * connect and off on close; heartbeats refresh `lastSeenInChatAt`, so a crashed instance's sockets
     * stop counting within the in-chat window.
     */
    chatOpen: boolean("chat_open").notNull().default(false),
    lastSeenInChatAt: ts("last_seen_in_chat_at"),
    /** The paywalls the app last reported it can show (phase B7), replaced whole on every report. */
    availablePaywalls: jsonb("available_paywalls").$type<ReportedPaywall[]>().notNull().default([]),
    paywallsReportedAt: ts("paywalls_reported_at"),
    /** The last review card sent to this device: automations skip devices already asked. */
    reviewAskedAt: ts("review_asked_at"),
    /** logout(): the credential is dead and the history stays; the app registers a new device next. */
    signedOutAt: ts("signed_out_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
    /** Unused: deleteData() removes the row. Kept until a later migration drops it. */
    deletedAt: ts("deleted_at"),
  },
  (t) => [
    index("devices_app_idx").on(t.appId),
    index("devices_app_user_idx").on(t.appId, t.userIdExt),
    index("devices_app_push_token_idx").on(t.appId, t.pushToken).where(sql`${t.pushToken} is not null`),
  ],
);

/**
 * A device's chat with the team. `last_seq` is the conversation's message counter: every append
 * increments it under the row lock, which is what orders messages without gaps.
 */
export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey(),
    /** Denormalized from the app (apps never change organization) so the inbox is one index scan. */
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    appId: uuid("app_id")
      .notNull()
      .references(() => apps.id, { onDelete: "cascade" }),
    deviceId: uuid("device_id")
      .notNull()
      .references(() => devices.id, { onDelete: "cascade" }),
    status: text("status", { enum: ["open", "closed"] }).notNull().default("open"),
    lastSeq: seq("last_seq").notNull().default(0),
    userReadSeq: seq("user_read_seq").notNull().default(0),
    teamReadSeq: seq("team_read_seq").notNull().default(0),
    unreadForUser: integer("unread_for_user").notNull().default(0),
    unreadForTeam: integer("unread_for_team").notNull().default(0),
    /** Millisecond precision so it round-trips through JS dates in pagination cursors. */
    lastMessageAt: timestamp("last_message_at", { withTimezone: true, mode: "date", precision: 3 }).notNull().defaultNow(),
    /** Set when identity changes start a fresh conversation for the device (phase B4). */
    supersededAt: ts("superseded_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    // one live conversation per device
    uniqueIndex("conversations_live_device_uq").on(t.deviceId).where(sql`${t.supersededAt} is null`),
    // the inbox query: newest activity first, per organization and status
    index("conversations_inbox_idx").on(t.organizationId, t.status, t.lastMessageAt.desc().nullsFirst(), t.id.desc().nullsFirst()),
    index("conversations_app_idx").on(t.appId),
  ],
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    seq: seq("seq").notNull(),
    sender: text("sender", { enum: ["user", "agent"] }).notNull(),
    source: text("source", { enum: ["sdk", "dashboard", "telegram", "automation", "ai"] }).notNull(),
    /** The teammate who wrote an agent message from the dashboard. */
    authorUserId: text("author_user_id").references(() => users.id, { onDelete: "set null" }),
    /** The device that sent a user message. */
    deviceId: uuid("device_id").references(() => devices.id, { onDelete: "cascade" }),
    /** Chosen by the sender per message; a retried send reuses it and gets the stored message back. */
    clientId: text("client_id"),
    kind: text("kind", { enum: ["text", "review", "paywall"] }).notNull().default("text"),
    text: text("text").notNull(),
    /** Review and offer messages: what the button does (phase B7). */
    card: jsonb("card").$type<StoredCard>(),
    /** The first tap on the card's button; later taps don't move it. */
    actionClickedAt: ts("action_clicked_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("messages_conversation_seq_uq").on(t.conversationId, t.seq),
    // card stats over the last 7–90 days
    index("messages_cards_idx").on(t.createdAt).where(sql`${t.kind} <> 'text'`),
    uniqueIndex("messages_device_client_uq").on(t.deviceId, t.clientId),
    uniqueIndex("messages_author_client_uq").on(t.authorUserId, t.clientId),
  ],
);
