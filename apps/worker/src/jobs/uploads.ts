import { attachments, type Db } from "@hshelby/db";
import type { Storage } from "@hshelby/storage";
import { and, inArray, isNull, lt } from "drizzle-orm";

const DAY = 24 * 60 * 60 * 1000;
const BATCH = 500;

/**
 * Uploads that never made it into a message (abandoned, or refused when sent) are removed a day later:
 * the object first, then the row, so an interrupted run never leaves an object nothing points to. The API
 * stops accepting an upload for sending at 23 hours, so none of these can be attached while they go.
 */
export async function removeUnsentUploads(db: Db, storage: Storage, now = new Date()) {
  const cutoff = new Date(now.getTime() - DAY);
  let removed = 0;
  for (;;) {
    const stale = await db
      .select({ id: attachments.id, objectKey: attachments.objectKey })
      .from(attachments)
      .where(and(isNull(attachments.messageId), lt(attachments.createdAt, cutoff)))
      .limit(BATCH);
    if (stale.length === 0) break;
    await storage.deleteKeys(stale.map((a) => a.objectKey));
    await db.delete(attachments).where(and(inArray(attachments.id, stale.map((a) => a.id)), isNull(attachments.messageId)));
    removed += stale.length;
    if (stale.length < BATCH) break;
  }
  return removed;
}
