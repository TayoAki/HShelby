import { boolean, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { apps } from "./apps";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

/** An app's APNs credentials (one .p8 key covers sandbox and production) and notification content. */
export const pushConfigs = pgTable("push_configs", {
  appId: uuid("app_id")
    .primaryKey()
    .references(() => apps.id, { onDelete: "cascade" }),
  teamId: text("team_id").notNull(),
  keyId: text("key_id").notNull(),
  /** The .p8 key (PKCS#8 PEM), encrypted with the ENC_KEYS keyring. */
  p8Enc: text("p8_enc").notNull(),
  /** The APNs topic. */
  bundleId: text("bundle_id").notNull(),
  /** Placeholders: {message}, {agent}, {app}. */
  titleTemplate: text("title_template").notNull(),
  bodyTemplate: text("body_template").notNull(),
  /** Replaces {agent} for every sender when set. */
  senderName: text("sender_name"),
  /** Off: {message} becomes a generic line, so replies don't show on the lock screen. */
  showPreview: boolean("show_preview").notNull().default(true),
  sound: boolean("sound").notNull().default(true),
  /** Set when APNs rejects the key itself (e.g. InvalidProviderToken); cleared by a delivery or a new key. */
  issue: text("issue"),
  issueAt: ts("issue_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});
