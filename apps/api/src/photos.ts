import { createHash } from "node:crypto";
import { PHOTO_LIMITS, type Attachment, type PhotoType } from "@hshelby/contracts";
import { attachments, type Db, type Tx } from "@hshelby/db";
import { inspectImage, type Storage } from "@hshelby/storage";
import { and, asc, eq, gt, inArray, isNull } from "drizzle-orm";
import { ApiError } from "./errors";

/*
 * Photos: the SDK asks for an upload ticket, PUTs the file straight to the bucket, then sends a message with
 * the attachment IDs. Nothing the client declared is trusted: before the message is stored, the server reads
 * each object back and checks its size, SHA-256, type and dimensions. Teammates upload through the API,
 * which checks the file the same way before storing it.
 */

export type AttachmentRow = typeof attachments.$inferSelect;

export const UPLOAD_URL_SECONDS = 15 * 60;
export const DOWNLOAD_URL_SECONDS = 15 * 60;

/**
 * An upload has to be sent within 23 hours. The worker removes unsent uploads after 24, so the hour between
 * keeps a send from attaching a photo the sweep is deleting.
 */
const SEND_WITHIN_MS = 23 * 60 * 60 * 1000;
export const sendableSince = () => new Date(Date.now() - SEND_WITHIN_MS);

/** Every photo of a device lives under one prefix, so deleting the device's data is one prefix delete. */
export const devicePrefix = (appId: string, deviceId: string) => `apps/${appId}/devices/${deviceId}/`;
export const objectKey = (appId: string, deviceId: string, attachmentId: string, type: PhotoType) =>
  `${devicePrefix(appId, deviceId)}${attachmentId}.${type === "image/png" ? "png" : "jpg"}`;

export function requireStorage(storage: Storage | null): Storage {
  if (!storage) throw new ApiError(503, "uploads_not_configured", "Photos aren't set up on this server");
  return storage;
}

export const sha256Base64 = (body: Buffer) => createHash("sha256").update(body).digest("base64");

/** A JPEG or PNG within the limits, judged from the file itself. */
export function checkImage(body: Buffer) {
  const info = inspectImage(body);
  if (!info || body.length > PHOTO_LIMITS.bytes || Math.max(info.width, info.height) > PHOTO_LIMITS.pixels) {
    throw new ApiError(422, "invalid_attachment", "Photos must be JPEG or PNG, up to 1 MB and 2048 pixels");
  }
  return info;
}

/**
 * Checks a device's uploads before they're sent: each must be the device's own and unsent, and the stored
 * bytes must match the declared size and SHA-256 and be a real JPEG or PNG within limits. A missing object
 * is `upload_incomplete` (the SDK can PUT again); anything else wrong is `invalid_attachment`.
 */
export async function verifyUploads(db: Db, storage: Storage, deviceId: string, ids: string[]) {
  if (ids.length === 0) return;
  const rows = await db
    .select()
    .from(attachments)
    .where(
      and(
        inArray(attachments.id, ids),
        eq(attachments.deviceId, deviceId),
        eq(attachments.uploadedBy, "user"),
        isNull(attachments.messageId),
        gt(attachments.createdAt, sendableSince()),
      ),
    );
  if (rows.length !== ids.length) throw new ApiError(422, "invalid_attachment", "Unknown, expired or already sent attachment");

  for (const row of rows) {
    if (row.status === "verified") continue; // checked by an earlier send that then failed
    const body = await storage.read(row.objectKey, PHOTO_LIMITS.bytes);
    if (!body) throw new ApiError(409, "upload_incomplete", "Upload the photo before sending it");
    if (body.length !== row.bytes || sha256Base64(body) !== row.sha256) {
      throw new ApiError(422, "invalid_attachment", "The uploaded file doesn't match its size and checksum");
    }
    const info = checkImage(body);
    if (info.contentType !== row.contentType) throw new ApiError(422, "invalid_attachment", "The file type doesn't match");
    await db
      .update(attachments)
      .set({ status: "verified", verifiedAt: new Date(), width: info.width, height: info.height })
      .where(eq(attachments.id, row.id));
  }
}

/**
 * Inside the message's transaction: attaches verified, unsent photos of the conversation's device to the
 * message. The age check is here, not only in `verifyUploads`, because this is the write the sweep races.
 */
export async function linkAttachments(
  tx: Tx,
  input: { messageId: string; deviceId: string; uploadedBy: "user" | "agent"; ids: string[] },
) {
  if (input.ids.length === 0) return;
  const linked = await tx
    .update(attachments)
    .set({ messageId: input.messageId })
    .where(
      and(
        inArray(attachments.id, input.ids),
        eq(attachments.deviceId, input.deviceId),
        eq(attachments.uploadedBy, input.uploadedBy),
        eq(attachments.status, "verified"),
        isNull(attachments.messageId),
        gt(attachments.createdAt, sendableSince()),
      ),
    )
    .returning({ id: attachments.id });
  if (linked.length !== input.ids.length) throw new ApiError(422, "invalid_attachment", "Unknown, expired or already sent attachment");
}

export async function toAttachment(storage: Storage, row: AttachmentRow): Promise<Attachment> {
  return {
    id: row.id,
    url: await storage.presignDownload(row.objectKey, DOWNLOAD_URL_SECONDS),
    contentType: row.contentType,
    width: row.width,
    height: row.height,
  };
}

/** The photos of these messages, with fresh signed links (signing is local; it costs no request). */
export async function attachmentsByMessage(db: Db, storage: Storage | null, messageIds: string[]) {
  const byMessage = new Map<string, Attachment[]>();
  if (!storage || messageIds.length === 0) return byMessage;
  const rows = await db
    .select()
    .from(attachments)
    .where(and(inArray(attachments.messageId, messageIds), eq(attachments.status, "verified")))
    .orderBy(asc(attachments.id));
  for (const row of rows) {
    const list = byMessage.get(row.messageId!) ?? [];
    list.push(await toAttachment(storage, row));
    byMessage.set(row.messageId!, list);
  }
  return byMessage;
}
