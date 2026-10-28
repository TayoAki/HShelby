import { randomBytes, randomUUID } from "node:crypto";
import { encryptSecret, parseKeyring, uuidv7 } from "@hshelby/core";
import { apps, conversations, createDb, devices, messages, organizations, pushConfigs, users } from "@hshelby/db";
import { createApnsClient } from "@hshelby/push";
import { generateP8, startFakeApns } from "@hshelby/push/testing";
import { eq } from "drizzle-orm";

/** The test database, a keyring, an APNs key and fake sandbox/production APNs servers to deliver to. */
export async function pushFixture() {
  const { db, pool } = createDb(process.env.TEST_DATABASE_URL ?? "postgres://postgres@localhost:5433/hshelby_test");
  const keyring = parseKeyring(`v1:${randomBytes(32).toString("base64")}`);
  const key = generateP8();
  const apnsIds = { teamId: "TEAM123456", keyId: "KEY1234567" };
  const sandbox = await startFakeApns({ verifyWith: key.publicKey, ...apnsIds });
  const production = await startFakeApns({ verifyWith: key.publicKey, ...apnsIds });
  const apns = createApnsClient({ hosts: { sandbox: sandbox.url, production: production.url } });

  /** An app with push set up, a device with a token, and one teammate reply waiting to be pushed. */
  async function scenario(options: { p8?: string; push?: boolean; device?: Partial<typeof devices.$inferInsert>; unread?: number } = {}) {
    const organizationId = uuidv7();
    const appId = uuidv7();
    const deviceId = uuidv7();
    const conversationId = uuidv7();
    const authorId = uuidv7();
    const token = randomBytes(32).toString("hex");
    await db.insert(organizations).values({ id: organizationId, name: "Push org", slug: `push-${organizationId}` });
    await db.insert(users).values({ id: authorId, name: "Ada Lovelace", email: `${authorId}@example.com` });
    await db.insert(apps).values({
      id: appId,
      organizationId,
      publicId: `app_${randomUUID().replaceAll("-", "").slice(0, 22)}`,
      name: "LockdList",
      identitySecretEnc: "unused",
    });
    if (options.push !== false) {
      await db.insert(pushConfigs).values({
        appId,
        ...apnsIds,
        p8Enc: encryptSecret(options.p8 ?? key.p8, keyring),
        bundleId: "com.example.lockdlist",
        titleTemplate: "{app}",
        bodyTemplate: "{agent}: {message}",
      });
    }
    await db.insert(devices).values({
      id: deviceId,
      appId,
      secretHash: randomUUID(),
      pushToken: token,
      pushEnv: "production",
      ...options.device,
    });
    await db.insert(conversations).values({
      id: conversationId,
      organizationId,
      appId,
      deviceId,
      lastSeq: 2,
      unreadForUser: options.unread ?? 1,
    });
    const userMessageId = uuidv7();
    const replyId = uuidv7();
    await db.insert(messages).values([
      { id: userMessageId, conversationId, seq: 1, sender: "user", source: "sdk", deviceId, text: "My lists won't sync" },
      { id: replyId, conversationId, seq: 2, sender: "agent", source: "dashboard", authorUserId: authorId, text: "Try pulling to refresh" },
    ]);
    const device = async () => (await db.select().from(devices).where(eq(devices.id, deviceId)))[0]!;
    const config = async () => (await db.select().from(pushConfigs).where(eq(pushConfigs.appId, appId)))[0];
    return { appId, deviceId, conversationId, replyId, userMessageId, token, device, config };
  }

  const close = async () => {
    apns.close();
    await Promise.all([sandbox.close(), production.close(), pool.end()]);
  };
  return { db, keyring, apns, sandbox, production, scenario, close };
}
