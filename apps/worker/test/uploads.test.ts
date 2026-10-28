import { randomUUID } from "node:crypto";
import { uuidv7 } from "@hshelby/core";
import { apps, attachments, conversations, createDb, devices, messages, organizations } from "@hshelby/db";
import { pngBytes, testStorage } from "@hshelby/storage/testing";
import { eq, inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { purgeDeletedApps } from "../src/jobs/purge";
import { removeUnsentUploads } from "../src/jobs/uploads";

const { db, pool } = createDb(process.env.TEST_DATABASE_URL ?? "postgres://postgres@localhost:5433/hshelby_test");
const { storage } = await testStorage();
afterAll(async () => {
  storage.close();
  await pool.end();
});

const HOUR = 60 * 60 * 1000;

/** An app with one device and conversation, and a helper that stores a photo row plus its object. */
async function appWithDevice() {
  const organizationId = uuidv7();
  const appId = uuidv7();
  const deviceId = uuidv7();
  const conversationId = uuidv7();
  await db.insert(organizations).values({ id: organizationId, name: "Uploads org", slug: `uploads-${organizationId}` });
  await db.insert(apps).values({
    id: appId,
    organizationId,
    publicId: `app_${randomUUID().replaceAll("-", "").slice(0, 22)}`,
    name: "Uploads",
    identitySecretEnc: "unused",
  });
  await db.insert(devices).values({ id: deviceId, appId, secretHash: randomUUID() });
  await db.insert(conversations).values({ id: conversationId, organizationId, appId, deviceId, lastSeq: 1 });
  const messageId = uuidv7();
  await db.insert(messages).values({ id: messageId, conversationId, seq: 1, sender: "user", source: "sdk", deviceId, text: "" });

  async function photo(createdAt: Date, sent: boolean) {
    const id = uuidv7();
    const objectKey = `apps/${appId}/devices/${deviceId}/${id}.png`;
    const body = pngBytes(10, 10, 100);
    await storage.put(objectKey, body, "image/png");
    await db.insert(attachments).values({
      id,
      appId,
      deviceId,
      uploadedBy: "user",
      objectKey,
      contentType: "image/png",
      bytes: body.length,
      width: 10,
      height: 10,
      sha256: "unused",
      createdAt,
      ...(sent && { messageId, status: "verified" as const }),
    });
    return { id, objectKey };
  }
  return { appId, photo };
}

describe("unsent uploads", () => {
  it("disappear a day after upload, objects included; recent and sent photos stay", async () => {
    const now = new Date("2026-11-02T12:00:00Z");
    const { photo } = await appWithDevice();
    const abandoned = await photo(new Date(now.getTime() - 25 * HOUR), false);
    const recent = await photo(new Date(now.getTime() - 2 * HOUR), false);
    const sent = await photo(new Date(now.getTime() - 72 * HOUR), true);

    expect(await removeUnsentUploads(db, storage, now)).toBeGreaterThanOrEqual(1);
    expect(await db.select().from(attachments).where(eq(attachments.id, abandoned.id))).toHaveLength(0);
    expect(await storage.read(abandoned.objectKey, 10)).toBeNull();
    const kept = await db.select({ id: attachments.id }).from(attachments).where(inArray(attachments.id, [recent.id, sent.id]));
    expect(kept).toHaveLength(2);
    expect(await storage.read(recent.objectKey, 1000)).not.toBeNull();
    expect(await storage.read(sent.objectKey, 1000)).not.toBeNull();

    // a day later, the recent one goes too
    await removeUnsentUploads(db, storage, new Date(now.getTime() + 23 * HOUR));
    expect(await db.select().from(attachments).where(eq(attachments.id, recent.id))).toHaveLength(0);
  });
});

describe("deleted apps", () => {
  it("lose their photos with their data", async () => {
    const { appId, photo } = await appWithDevice();
    const { objectKey } = await photo(new Date(), true);
    await db.update(apps).set({ deletedAt: new Date() }).where(eq(apps.id, appId));
    await purgeDeletedApps(db, storage);
    expect(await storage.read(objectKey, 10)).toBeNull();
    expect(await db.select().from(apps).where(eq(apps.id, appId))).toHaveLength(0);
  });
});
