import type { PaywallProduct, PaywallSource, ReviewScenario } from "@hshelby/contracts";
import { boolean, jsonb, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { apps } from "./apps";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

/**
 * Every paywall any device of the app has reported, latest details first. It's what the app's Paywalls page
 * and the automation builder list; an offer to one person still checks that person's own report.
 */
export const appPaywalls = pgTable(
  "app_paywalls",
  {
    appId: uuid("app_id")
      .notNull()
      .references(() => apps.id, { onDelete: "cascade" }),
    paywallId: text("paywall_id").notNull(),
    title: text("title").notNull(),
    source: text("source").$type<PaywallSource>().notNull(),
    presentable: boolean("presentable").notNull(),
    products: jsonb("products").$type<PaywallProduct[]>().notNull(),
    firstReportedAt: ts("first_reported_at").notNull().defaultNow(),
    lastReportedAt: ts("last_reported_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.appId, t.paywallId] })],
);

/** An app's review templates and the button labels teammates pick from. Defaults apply until it's saved. */
export const cardSettings = pgTable("card_settings", {
  appId: uuid("app_id")
    .primaryKey()
    .references(() => apps.id, { onDelete: "cascade" }),
  reviewTemplates: jsonb("review_templates").$type<Record<ReviewScenario, string>>().notNull(),
  reviewButtonLabels: jsonb("review_button_labels").$type<string[]>().notNull(),
  offerButtonLabels: jsonb("offer_button_labels").$type<string[]>().notNull(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});
