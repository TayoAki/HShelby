import type { AutomationDefinition, Provider, ProviderEventStatus, RunReason, RunStatus, SubscriptionEvent } from "@hshelby/contracts";
import { sql } from "drizzle-orm";
import { boolean, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { apps } from "./apps";
import { users } from "./auth";
import { devices } from "./messaging";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

/**
 * A subscription provider connected to an app (phase B10). RevenueCat and Adapty send the Authorization value
 * we generated; Superwall signs with its own `whsec_` secret; the App Store signs with Apple's certificates.
 */
export const providerIntegrations = pgTable(
  "provider_integrations",
  {
    appId: uuid("app_id")
      .notNull()
      .references(() => apps.id, { onDelete: "cascade" }),
    provider: text("provider").$type<Provider>().notNull(),
    /** Encrypted with the ENC_KEYS keyring; null for the App Store. */
    secretEnc: text("secret_enc"),
    createdAt: ts("created_at").notNull().defaultNow(),
    lastEventAt: ts("last_event_at"),
  },
  (t) => [primaryKey({ columns: [t.appId, t.provider] })],
);

/** Every delivery a provider made, for the Recent events log and to make redeliveries no-ops. */
export const providerEvents = pgTable(
  "provider_events",
  {
    id: uuid("id").primaryKey(),
    appId: uuid("app_id")
      .notNull()
      .references(() => apps.id, { onDelete: "cascade" }),
    provider: text("provider").$type<Provider>().notNull(),
    /** The provider's event ID (null when the delivery was refused before it could be read). */
    providerEventId: text("provider_event_id"),
    rawType: text("raw_type"),
    event: text("event").$type<SubscriptionEvent>(),
    status: text("status").$type<ProviderEventStatus>().notNull(),
    reason: text("reason"),
    environment: text("environment", { enum: ["production", "sandbox"] }),
    person: text("person"),
    productId: text("product_id"),
    deviceIds: uuid("device_ids").array().notNull().default(sql`'{}'::uuid[]`),
    receivedAt: ts("received_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("provider_events_dedupe_uq").on(t.appId, t.provider, t.providerEventId).where(sql`${t.providerEventId} is not null`),
    index("provider_events_app_idx").on(t.appId, t.receivedAt),
    // "bought within 7 days" in automation results
    index("provider_events_devices_idx").using("gin", t.deviceIds),
  ],
);

/** An automation: the trigger event, audience, wait and steps (`definition`), and whether it's on. */
export const automations = pgTable(
  "automations",
  {
    id: uuid("id").primaryKey(),
    appId: uuid("app_id")
      .notNull()
      .references(() => apps.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    enabled: boolean("enabled").notNull().default(false),
    /** Copied from the definition so a tracked event finds its automations by index. */
    triggerEvent: text("trigger_event").notNull(),
    definition: jsonb("definition").$type<AutomationDefinition>().notNull(),
    senderUserId: text("sender_user_id").references(() => users.id, { onDelete: "set null" }),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [index("automations_trigger_idx").on(t.appId, t.triggerEvent).where(sql`${t.enabled}`)],
);

/**
 * One person (device) going through an automation. `stepIndex` is the next step to send; a step's message and
 * the move past it commit together, so a retried job never sends twice.
 */
export const automationRuns = pgTable(
  "automation_runs",
  {
    id: uuid("id").primaryKey(),
    automationId: uuid("automation_id")
      .notNull()
      .references(() => automations.id, { onDelete: "cascade" }),
    deviceId: uuid("device_id")
      .notNull()
      .references(() => devices.id, { onDelete: "cascade" }),
    status: text("status").$type<RunStatus>().notNull(),
    reason: text("reason").$type<RunReason>(),
    stepIndex: integer("step_index").notNull().default(0),
    /** When the run (or its next step) is due; null when nothing is scheduled. */
    nextAt: ts("next_at"),
    firstSentAt: ts("first_sent_at"),
    messageIds: uuid("message_ids").array().notNull().default(sql`'{}'::uuid[]`),
    openChat: boolean("open_chat").notNull().default(false),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("automation_runs_automation_device_idx").on(t.automationId, t.deviceId),
    index("automation_runs_status_idx").on(t.automationId, t.status, t.nextAt),
    index("automation_runs_device_idx").on(t.deviceId),
  ],
);
