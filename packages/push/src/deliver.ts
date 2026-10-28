import type { PushEnvironment } from "@hshelby/contracts";
import { decryptSecret, type Keyring } from "@hshelby/core";
import { apps, conversations, devices, messages, pushConfigs, users, type Db } from "@hshelby/db";
import { and, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { classify, type ApnsClient, type ApnsResult, type PushOutcome } from "./apns";
import { buildPushPayload } from "./content";

/** The job a teammate's reply enqueues, in the same transaction as the message. */
export const PUSH_QUEUE = "push.send";
// notify: wake the worker as soon as a reply is committed instead of on its next poll
export const PUSH_QUEUE_OPTIONS = { retryLimit: 5, retryDelay: 10, retryBackoff: true, retryDelayMax: 600, notify: true } as const;
export type PushJob = { messageId: string };

export type PushDeps = { db: Db; apns: ApnsClient; keyring: Keyring };

type PushConfigRow = typeof pushConfigs.$inferSelect;

/** Thrown for answers worth retrying (429, 5xx, timeouts), so the queue backs off and tries again. */
export class PushRetryError extends Error {}

const credentials = (config: PushConfigRow, keyring: Keyring) => ({
  teamId: config.teamId,
  keyId: config.keyId,
  p8: decryptSecret(config.p8Enc, keyring),
});

/**
 * Stores what an APNs answer means: a delivery clears earlier issues, a dead token is dropped, and
 * rejections are kept on the device or the app's config for the dashboard. Retryable failures throw,
 * except on the last attempt, where they're recorded as the device's issue instead.
 */
export async function recordOutcome(
  db: Db,
  target: { appId: string; deviceId: string; token: string },
  result: ApnsResult,
  { lastAttempt }: { lastAttempt: boolean },
): Promise<PushOutcome> {
  const outcome = classify(result);
  const reason = result.ok ? null : result.reason;
  const sameToken = and(eq(devices.id, target.deviceId), eq(devices.pushToken, target.token));
  switch (outcome) {
    case "delivered":
      await db.update(devices).set({ pushIssue: null, pushIssueAt: null }).where(and(sameToken, isNotNull(devices.pushIssue)));
      await db
        .update(pushConfigs)
        .set({ issue: null, issueAt: null })
        .where(and(eq(pushConfigs.appId, target.appId), isNotNull(pushConfigs.issue)));
      break;
    case "token_gone":
      // only if the device hasn't registered a newer token meanwhile
      await db.update(devices).set({ pushToken: null, pushIssue: reason, pushIssueAt: new Date() }).where(sameToken);
      break;
    case "device_issue":
      await db.update(devices).set({ pushIssue: reason, pushIssueAt: new Date() }).where(sameToken);
      break;
    case "config_issue":
      await db.update(pushConfigs).set({ issue: reason, issueAt: new Date() }).where(eq(pushConfigs.appId, target.appId));
      break;
    case "retry":
      if (!lastAttempt) throw new PushRetryError(reason ?? "retry");
      await db.update(devices).set({ pushIssue: reason, pushIssueAt: new Date() }).where(sameToken);
      break;
  }
  return outcome;
}

/** Sends the push for one teammate reply, if the app and the device are set up for it. */
export async function deliverMessagePush(
  deps: PushDeps,
  messageId: string,
  { lastAttempt }: { lastAttempt: boolean },
): Promise<PushOutcome | "skipped"> {
  const [row] = await deps.db
    .select({
      message: messages,
      conversation: conversations,
      device: devices,
      appName: apps.name,
      config: pushConfigs,
      authorName: users.name,
    })
    .from(messages)
    .innerJoin(conversations, eq(conversations.id, messages.conversationId))
    .innerJoin(devices, eq(devices.id, conversations.deviceId))
    .innerJoin(apps, and(eq(apps.id, conversations.appId), isNull(apps.deletedAt)))
    .leftJoin(pushConfigs, eq(pushConfigs.appId, apps.id))
    .leftJoin(users, eq(users.id, messages.authorUserId))
    .where(eq(messages.id, messageId))
    .limit(1);
  const device = row?.device;
  if (!row || !row.config || row.message.sender !== "agent") return "skipped";
  if (!device?.pushToken || !device.pushEnv || device.signedOutAt) return "skipped";

  const result = await deps.apns.send(credentials(row.config, deps.keyring), device.pushEnv, {
    deviceToken: device.pushToken,
    topic: row.config.bundleId,
    payload: buildPushPayload(row.config, {
      appName: row.appName,
      authorName: row.authorName,
      message: row.message.text || "Sent a photo",
      conversationId: row.conversation.id,
      messageId: row.message.id,
      // read at send time, so it includes this reply and anything the user has read since
      badge: device.updatesAppBadge ? row.conversation.unreadForUser : null,
    }),
  });
  return recordOutcome(deps.db, { appId: row.conversation.appId, deviceId: device.id, token: device.pushToken }, result, {
    lastAttempt,
  });
}

export type TestPushResult = {
  device: typeof devices.$inferSelect;
  environment: PushEnvironment;
  result: ApnsResult;
};

/**
 * "Send test": a sample notification to up to `limit` devices that can receive pushes, most recently
 * active in chat first. Results come back right away and update each device's push issue.
 */
export async function sendTestPushes(deps: PushDeps, app: { id: string; name: string }, limit = 10): Promise<TestPushResult[] | null> {
  const [config] = await deps.db.select().from(pushConfigs).where(eq(pushConfigs.appId, app.id));
  if (!config) return null;
  const targets = await deps.db
    .select({ device: devices })
    .from(devices)
    .leftJoin(conversations, and(eq(conversations.deviceId, devices.id), isNull(conversations.supersededAt)))
    .where(and(eq(devices.appId, app.id), isNotNull(devices.pushToken), isNull(devices.signedOutAt)))
    .orderBy(sql`${conversations.lastMessageAt} desc nulls last`, desc(devices.lastSeenAt))
    .limit(limit);

  const creds = credentials(config, deps.keyring);
  const payload = buildPushPayload(config, {
    appName: app.name,
    authorName: null,
    message: "This is a test notification from your support chat.",
    conversationId: null,
    badge: null,
  });
  return Promise.all(
    targets.map(async ({ device }) => {
      const environment = device.pushEnv!;
      const result = await deps.apns.send(creds, environment, { deviceToken: device.pushToken!, topic: config.bundleId, payload });
      await recordOutcome(deps.db, { appId: app.id, deviceId: device.id, token: device.pushToken! }, result, { lastAttempt: true });
      return { device, environment, result };
    }),
  );
}
