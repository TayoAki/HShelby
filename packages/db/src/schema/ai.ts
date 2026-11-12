import type { AiAction, AiOutcome } from "@hshelby/contracts";
import { boolean, index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { apps } from "./apps";
import { users } from "./auth";
import { conversations, messages } from "./messaging";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

/** An app's AI replies (phase B11). Off until a teammate turns them on; defaults apply until it's saved. */
export const aiSettings = pgTable("ai_settings", {
  appId: uuid("app_id")
    .primaryKey()
    .references(() => apps.id, { onDelete: "cascade" }),
  enabled: boolean("enabled").notNull().default(false),
  name: text("name").notNull().default("Assistant"),
  instructions: text("instructions").notNull().default(""),
  docs: text("docs").notNull().default(""),
  allowOffers: boolean("allow_offers").notNull().default(true),
  allowReviews: boolean("allow_reviews").notNull().default(true),
  updatedAt: ts("updated_at").notNull().defaultNow(),
  updatedBy: text("updated_by").references(() => users.id, { onDelete: "set null" }),
});

/** Every time the AI was asked to answer: what it did, what was refused, and what it cost. */
export const aiRuns = pgTable(
  "ai_runs",
  {
    id: uuid("id").primaryKey(),
    appId: uuid("app_id")
      .notNull()
      .references(() => apps.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    /** The person's message it answered. */
    messageId: uuid("message_id").references(() => messages.id, { onDelete: "set null" }),
    outcome: text("outcome").$type<AiOutcome>().notNull(),
    actions: jsonb("actions").$type<AiAction[]>().notNull().default([]),
    /** Guardrail refusals the model was told about (an offer it couldn't send…). */
    notes: jsonb("notes").$type<string[]>().notNull().default([]),
    error: text("error"),
    fallback: boolean("fallback").notNull().default(false),
    /** The model the run asked for (null on runs before it was recorded). */
    model: text("model"),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
    cacheWriteTokens: integer("cache_write_tokens").notNull().default(0),
    latencyMs: integer("latency_ms").notNull().default(0),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("ai_runs_app_idx").on(t.appId, t.createdAt.desc()), index("ai_runs_conversation_idx").on(t.conversationId)],
);

/**
 * What each model call cost, kept apart from `ai_runs` on purpose: no foreign keys, so deleting a person's data, a
 * device or an app (which removes its runs) leaves the cost on record. It's what the daily ceilings count and what
 * a partner is billed from. No message content, and nothing that identifies the person.
 */
export const aiUsage = pgTable(
  "ai_usage",
  {
    /** A reply's `ai_runs` id; a preview has its own. Time-ordered, so it's the partner feed's cursor. */
    id: uuid("id").primaryKey(),
    organizationId: text("organization_id").notNull(),
    appId: uuid("app_id").notNull(),
    kind: text("kind").$type<"reply" | "preview">().notNull(),
    /** The partner and its ids for the workspace and the app, as they were when the model was called. */
    partner: text("partner"),
    workspaceExternalId: text("workspace_external_id"),
    appExternalId: text("app_external_id"),
    model: text("model"),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
    cacheWriteTokens: integer("cache_write_tokens").notNull().default(0),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("ai_usage_app_idx").on(t.appId, t.createdAt.desc()),
    index("ai_usage_organization_idx").on(t.organizationId, t.kind, t.createdAt.desc()),
    index("ai_usage_partner_idx").on(t.partner, t.id),
  ],
);
