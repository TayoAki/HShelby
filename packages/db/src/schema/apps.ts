import { sql } from "drizzle-orm";
import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
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
    /** Set when the SDK delivers the app's first message (phase B1). */
    firstMessageAt: ts("first_message_at"),
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
