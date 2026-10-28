import { apps, devices, type Db } from "@hshelby/db";
import type { Storage } from "@hshelby/storage";
import { eq, inArray, isNotNull } from "drizzle-orm";

const BATCH = 500;

/**
 * Purges apps deleted from the dashboard. The dashboard hides a deleted app at once; this makes its data
 * go away: its photos, then devices in batches (each cascading to its conversations and messages, so no
 * transaction holds a whole app's history), then the app row. An interrupted run picks up where it stopped.
 */
export async function purgeDeletedApps(db: Db, storage: Storage | null, limit = 10) {
  const deleted = await db.select({ id: apps.id }).from(apps).where(isNotNull(apps.deletedAt)).limit(limit);
  let purgedDevices = 0;
  for (const app of deleted) {
    await storage?.deletePrefix(`apps/${app.id}/`);
    for (;;) {
      const batch = db.select({ id: devices.id }).from(devices).where(eq(devices.appId, app.id)).limit(BATCH);
      const removed = await db.delete(devices).where(inArray(devices.id, batch)).returning({ id: devices.id });
      purgedDevices += removed.length;
      if (removed.length < BATCH) break;
    }
    await db.delete(apps).where(eq(apps.id, app.id));
  }
  return { apps: deleted.length, devices: purgedDevices };
}
