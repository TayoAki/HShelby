import { sql } from "drizzle-orm";
import { boolean, index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { organizations, users } from "./auth";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

/** An iOS app connected to an organization. `publicId` (app_…) is what the SDK is configured with. */
export const apps = pgTable(
  "apps",
  {
    id: uuid("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    publicId: text("public_id").notNull().unique(),
    name: text("name").notNull(),
    iconUrl: text("icon_url"),
    bundleId: text("bundle_id"),
    appStoreId: text("app_store_id"),
    appStoreUrl: text("app_store_url"),
    sellerName: text("seller_name"),
    /** `ids_…` secret for identity verification, encrypted with the ENC_KEYS keyring. */
    identitySecretEnc: text("identity_secret_enc").notNull(),
    identitySecretRotatedAt: ts("identity_secret_rotated_at"),
    /** "Only verified users can chat": unverified devices can read but not send. */
    onlyVerified: boolean("only_verified").notNull().default(false),
    /** Set when the SDK delivers the app's first message (phase B1). */
    firstMessageAt: ts("first_message_at"),
    /**
     * The conversation of that first message: the developer's own test device during setup. The team can
     * reply there without a subscription. Not a foreign key; if the conversation is deleted, nothing matches.
     */
    setupConversationId: uuid("setup_conversation_id"),
    /** Team photos and names beside replies in the app (phase B9); these switches apply without publishing. */
    showTeamPhotos: boolean("show_team_photos").notNull().default(false),
    showTeamNames: boolean("show_team_names").notNull().default(false),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
    deletedAt: ts("deleted_at"),
  },
  (t) => [
    index("apps_org_idx").on(t.organizationId).where(sql`${t.deletedAt} is null`),
    // the same App Store app can be added only once per organization
    uniqueIndex("apps_org_app_store_uq")
      .on(t.organizationId, t.appStoreId)
      .where(sql`${t.appStoreId} is not null and ${t.deletedAt} is null`),
  ],
);

/** Who did what to sensitive settings (secret reveals, deletions). */
export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    target: text("target"),
    metadata: jsonb("metadata"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("audit_events_org_created_idx").on(t.organizationId, t.createdAt)],
);
