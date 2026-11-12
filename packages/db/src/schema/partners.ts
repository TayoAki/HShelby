import { index, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { apps } from "./apps";
import { organizations } from "./auth";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

/**
 * Apps a partner (an app builder, configured in PARTNERS) created for its users through the partner API, by the
 * partner's own ID for the project. One owner's apps share a workspace per partner.
 */
export const partnerApps = pgTable(
  "partner_apps",
  {
    partner: text("partner").notNull(),
    externalId: text("external_id").notNull(),
    appId: uuid("app_id")
      .notNull()
      .references(() => apps.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    /** Lowercased. */
    ownerEmail: text("owner_email").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.partner, t.externalId] }), index("partner_apps_owner_idx").on(t.partner, t.ownerEmail)],
);
