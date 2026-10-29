import type { AppearanceDocument, LocalAppearance } from "@hshelby/contracts";
import { sql } from "drizzle-orm";
import { index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { apps } from "./apps";
import { organizations, users } from "./auth";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

/**
 * An app's remote appearance: the draft the team edits and the document apps get. Saves name the draft version
 * they started from, so two editors can't overwrite each other. The asset ID columns say which library images
 * each document uses: those can't be deleted, and only published ones are served publicly.
 */
export const appAppearance = pgTable(
  "app_appearance",
  {
    appId: uuid("app_id")
      .primaryKey()
      .references(() => apps.id, { onDelete: "cascade" }),
    draft: jsonb("draft").$type<AppearanceDocument>().notNull().default({}),
    draftVersion: integer("draft_version").notNull().default(0),
    draftAssetIds: uuid("draft_asset_ids").array().notNull().default(sql`'{}'::uuid[]`),
    draftUpdatedAt: ts("draft_updated_at"),
    draftUpdatedBy: text("draft_updated_by").references(() => users.id, { onDelete: "set null" }),
    published: jsonb("published").$type<AppearanceDocument>(),
    publishedVersion: integer("published_version").notNull().default(0),
    publishedAssetIds: uuid("published_asset_ids").array().notNull().default(sql`'{}'::uuid[]`),
    publishedAt: ts("published_at"),
    publishedBy: text("published_by").references(() => users.id, { onDelete: "set null" }),
    /** What the app's own code sets, as its SDK last reported it. */
    reportedLocal: jsonb("reported_local").$type<LocalAppearance>(),
    reportedAt: ts("reported_at"),
  },
  (t) => [
    index("app_appearance_published_assets_idx").using("gin", t.publishedAssetIds),
    index("app_appearance_draft_assets_idx").using("gin", t.draftAssetIds),
  ],
);

/** The workspace's image library, shared by its apps: transparent PNGs of at most 512 px. */
export const assets = pgTable(
  "assets",
  {
    id: uuid("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    objectKey: text("object_key").notNull().unique(),
    bytes: integer("bytes").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("assets_org_idx").on(t.organizationId, t.createdAt)],
);

/** A teammate's profile photo, shown beside their replies in apps that turn on team photos. */
export const userPhotos = pgTable("user_photos", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  objectKey: text("object_key").notNull(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});
