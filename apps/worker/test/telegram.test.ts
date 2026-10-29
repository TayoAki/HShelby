import { randomUUID } from "node:crypto";
import { encryptSecret, uuidv7 } from "@hshelby/core";
import { apps, conversations, devices, messages, organizations, telegramBots, telegramConnections } from "@hshelby/db";
import { createTelegramClient, TEAM_NOTIFY_QUEUE } from "@hshelby/telegram";
import { startFakeTelegram } from "@hshelby/telegram/testing";
import { sql } from "drizzle-orm";
import { PgBoss } from "pg-boss";
import pino from "pino";
import { afterAll, expect, it } from "vitest";
import { startWorker } from "../src/worker";
import { pushFixture } from "./push-fixture";

/*
 * Telegram allows about 20 messages a minute in a group; the worker posts at most one per interval per chat.
 * Scaled down here: one post per 110 ms against a fake Telegram that refuses more than 20 in any 2 s.
 */
const INTERVAL_MS = 110;
const fake = await startFakeTelegram({ perChatLimit: { count: 20, windowMs: 2000 } });
const fx = await pushFixture();
const schema = "pgboss_telegram_test";
await fx.db.execute(sql.raw(`drop schema if exists ${schema} cascade`));
const boss = new PgBoss({
  connectionString: process.env.TEST_DATABASE_URL ?? "postgres://postgres@localhost:5433/hshelby_test",
  schema,
  useListenNotify: true,
});
await startWorker({
  db: fx.db,
  boss,
  apns: fx.apns,
  keyring: fx.keyring,
  storage: null,
  stripe: null,
  telegram: createTelegramClient({ baseUrl: fake.url }),
  telegramIntervalMs: INTERVAL_MS,
  logger: pino({ level: "silent" }),
});
afterAll(async () => {
  await boss.stop({ graceful: false });
  await fake.close();
  await fx.close();
});

/** An app connected to a fresh group, and a conversation with `count` customer messages waiting to be posted. */
async function burst(count: number) {
  const token = fake.addBot();
  const chatId = fake.addChat({ botTokens: [token] });
  const organizationId = uuidv7();
  const appId = uuidv7();
  const botId = uuidv7();
  const deviceId = uuidv7();
  const conversationId = uuidv7();
  await fx.db.insert(organizations).values({ id: organizationId, name: "Telegram org", slug: `tg-${organizationId}` });
  await fx.db.insert(apps).values({ id: appId, organizationId, publicId: `app_${randomUUID().replaceAll("-", "").slice(0, 22)}`, name: "LockdList", identitySecretEnc: "unused" });
  await fx.db.insert(telegramBots).values({
    id: botId,
    organizationId,
    telegramBotId: Number(token.split(":")[0]),
    username: "support_bot",
    tokenEnc: encryptSecret(token, fx.keyring),
    webhookSecretHash: "unused",
  });
  await fx.db.insert(telegramConnections).values({ appId, botId, chatId, chatType: "group" });
  await fx.db.insert(devices).values({ id: deviceId, appId, secretHash: randomUUID(), name: "Alex Rivera" });
  await fx.db.insert(conversations).values({ id: conversationId, organizationId, appId, deviceId, lastSeq: count });
  const ids = Array.from({ length: count }, () => uuidv7());
  await fx.db.insert(messages).values(
    ids.map((id, i) => ({ id, conversationId, seq: i + 1, sender: "user" as const, source: "sdk" as const, deviceId, clientId: randomUUID(), text: `Message ${i + 1}` })),
  );
  return { chatId, ids };
}

it("posts a burst of 50 customer messages in order, within the per-chat limit", async () => {
  const { chatId, ids } = await burst(50);
  // back to back, the way 50 quick sends enqueue them (each in its own message's transaction)
  for (const messageId of ids) await boss.send(TEAM_NOTIFY_QUEUE, { messageId }, { singletonKey: messageId });

  const deadline = Date.now() + 30_000;
  while (fake.sentTo(chatId).length < 50 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
  const posted = fake.sentTo(chatId);

  expect(posted.map((m) => m.text!.split("\n")[1])).toEqual(ids.map((_, i) => `Message ${i + 1}`));
  expect(fake.rateLimited).toEqual([]);
  const gaps = posted.slice(1).map((m, i) => m.date - posted[i]!.date);
  expect(Math.min(...gaps)).toBeGreaterThanOrEqual(INTERVAL_MS - 5);
}, 40_000);
