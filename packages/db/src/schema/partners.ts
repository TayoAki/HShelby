import { boolean, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { apps } from "./apps";
import { organizations } from "./auth";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

/**
 * A workspace a partner (App Builder) created for one of its users through the partner API. While `active` (the
 * user's plan with the partner is paid) it counts as subscribed; `ai_allowed` turns AI replies off when the user
 * runs out of the partner's credits.
 */
export const partnerWorkspaces = pgTable(
  "partner_workspaces",
  {
    organizationId: text("organization_id")
      .primaryKey()
      .references(() => organizations.id, { onDelete: "cascade" }),
    partner: text("partner").notNull(),
    /** The partner's id for its user. */
    externalId: text("external_id").notNull(),
    /** Who may claim the workspace (lowercased). */
    ownerEmail: text("owner_email").notNull(),
    active: boolean("active").notNull().default(true),
    aiAllowed: boolean("ai_allowed").notNull().default(true),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("partner_workspaces_external_uq").on(t.partner, t.externalId)],
);

/** An app a partner created in one of its workspaces, by the partner's project id. */
export const partnerApps = pgTable(
  "partner_apps",
  {
    appId: uuid("app_id")
      .primaryKey()
      .references(() => apps.id, { onDelete: "cascade" }),
    partner: text("partner").notNull(),
    externalId: text("external_id").notNull(),
  },
  (t) => [uniqueIndex("partner_apps_external_uq").on(t.partner, t.externalId)],
);

/** A one-time link for the owner to join a partner workspace: the token's SHA-256 (the token itself is never stored). */
export const partnerClaims = pgTable("partner_claims", {
  tokenHash: text("token_hash").primaryKey(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  /** Lowercased: only this address can use it. */
  email: text("email").notNull(),
  expiresAt: ts("expires_at").notNull(),
  usedAt: ts("used_at"),
});
