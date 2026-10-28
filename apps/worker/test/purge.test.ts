import { randomUUID } from "node:crypto";
import { uuidv7 } from "@hshelby/core";
import { apps, conversations, createDb, devices, messages, organizations } from "@hshelby/db";
import { eq, inArray } from "drizzle-orm";
import { afterAll, expect, it } from "vitest";
import { purgeDeletedApps } from "../src/jobs/purge";

const { db, pool } = createDb(process.env.TEST_DATABASE_URL ?? "postgres://postgres@localhost:5433/hshelby_test");
afterAll(() => pool.end());

async function appWithHistory(organizationId: string, deviceCount: number) {
  const appId = uuidv7();
  await db.insert(apps).values({
    id: appId,
    organizationId,
    publicId: `app_${randomUUID().replaceAll("-", "").slice(0, 22)}`,
    name: "Purge test",
    identitySecretEnc: "v1:unused",
  });
  const deviceIds: string[] = [];
  for (let i = 0; i < deviceCount; i++) {
    const deviceId = uuidv7();
    const conversationId = uuidv7();
    await db.insert(devices).values({ id: deviceId, appId, secretHash: randomUUID() });
    await db.insert(conversations).values({ id: conversationId, organizationId, appId, deviceId, lastSeq: 1 });
    await db.insert(messages).values({ id: uuidv7(), conversationId, seq: 1, sender: "user", source: "sdk", deviceId, text: "hi" });
    deviceIds.push(deviceId);
  }
  return { appId, deviceIds };
}

it("purges deleted apps with every device, conversation and message, and leaves live apps alone", async () => {
  const organizationId = uuidv7();
  await db.insert(organizations).values({ id: organizationId, name: "Purge org", slug: `purge-${organizationId}` });
  const doomed = await appWithHistory(organizationId, 3);
  const kept = await appWithHistory(organizationId, 1);
  await db.update(apps).set({ deletedAt: new Date() }).where(eq(apps.id, doomed.appId));

  const purged = await purgeDeletedApps(db);
  expect(purged.apps).toBeGreaterThanOrEqual(1);
  expect(purged.devices).toBeGreaterThanOrEqual(3);

  expect(await db.select().from(apps).where(eq(apps.id, doomed.appId))).toHaveLength(0);
  expect(await db.select().from(devices).where(inArray(devices.id, doomed.deviceIds))).toHaveLength(0);
  expect(await db.select().from(conversations).where(eq(conversations.appId, doomed.appId))).toHaveLength(0);
  expect(await db.select().from(messages).where(inArray(messages.deviceId, doomed.deviceIds))).toHaveLength(0);

  expect(await db.select().from(devices).where(eq(devices.appId, kept.appId))).toHaveLength(1);
  expect(await db.select().from(messages).where(inArray(messages.deviceId, kept.deviceIds))).toHaveLength(1);
});
