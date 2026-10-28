import { sql } from "drizzle-orm";
import { index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { apps } from "./apps";
import { users } from "./auth";
import { devices, messages } from "./messaging";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

/**
 * A photo in a device's conversation, uploaded by the user (presigned PUT, then verified when sent) or
 * by a teammate (through the API, verified on upload). Objects live under
 * `apps/<app>/devices/<device>/`, so a device's or app's photos go with a prefix delete.
 */
export const attachments = pgTable(
  "attachments",
  {
    id: uuid("id").primaryKey(),
    appId: uuid("app_id")
      .notNull()
      .references(() => apps.id, { onDelete: "cascade" }),
    deviceId: uuid("device_id")
      .notNull()
      .references(() => devices.id, { onDelete: "cascade" }),
    uploadedBy: text("uploaded_by", { enum: ["user", "agent"] }).notNull(),
    authorUserId: text("author_user_id").references(() => users.id, { onDelete: "set null" }),
    /** Null until the message that carries it is sent. */
    messageId: uuid("message_id").references(() => messages.id, { onDelete: "cascade" }),
    objectKey: text("object_key").notNull().unique(),
    contentType: text("content_type", { enum: ["image/jpeg", "image/png"] }).notNull(),
    bytes: integer("bytes").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    /** Base64 SHA-256 the uploader declared; the stored bytes must match it. */
    sha256: text("sha256").notNull(),
    status: text("status", { enum: ["pending", "verified"] }).notNull().default("pending"),
    createdAt: ts("created_at").notNull().defaultNow(),
    verifiedAt: ts("verified_at"),
  },
  (t) => [
    index("attachments_message_idx").on(t.messageId),
    index("attachments_device_idx").on(t.deviceId),
    // the hourly sweep of uploads that were never sent
    index("attachments_unsent_idx").on(t.createdAt).where(sql`${t.messageId} is null`),
  ],
);
