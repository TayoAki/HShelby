import type { Keyring } from "@hshelby/core";
import type { Db } from "@hshelby/db";
import { deliverMessagePush, PUSH_QUEUE, PUSH_QUEUE_OPTIONS, type ApnsClient, type PushJob } from "@hshelby/push";
import type { PgBoss } from "pg-boss";
import type { Logger } from "pino";
import { runCleanup } from "./jobs/cleanup";
import { purgeDeletedApps } from "./jobs/purge";

const QUEUES = { cleanup: "maintenance.cleanup", purgeApps: "purge.deleted-apps" } as const;

export type WorkerDeps = { db: Db; boss: PgBoss; apns: ApnsClient; keyring: Keyring; logger: Logger };

/** Creates the queues and schedules, and starts working them. */
export async function startWorker({ db, boss, apns, keyring, logger }: WorkerDeps) {
  await boss.start();
  for (const queue of Object.values(QUEUES)) await boss.createQueue(queue);
  await boss.createQueue(PUSH_QUEUE, PUSH_QUEUE_OPTIONS);
  // pg-boss keeps one schedule per name across worker replicas.
  await boss.schedule(QUEUES.cleanup, "0 3 * * *", null, { tz: "UTC" });
  await boss.schedule(QUEUES.purgeApps, "*/15 * * * *", null, { tz: "UTC" });

  await boss.work(QUEUES.cleanup, async () => {
    const removed = await runCleanup(db);
    logger.info({ removed }, "cleanup finished");
    return removed;
  });

  await boss.work(QUEUES.purgeApps, async () => {
    const purged = await purgeDeletedApps(db);
    if (purged.apps > 0) logger.info({ purged }, "deleted apps purged");
    return purged;
  });

  // Retryable APNs answers throw, so pg-boss backs off and tries again; the last attempt records the
  // failure on the device instead.
  await boss.work<PushJob>(PUSH_QUEUE, { localConcurrency: 4 }, async ([job]) => {
    const outcome = await deliverMessagePush({ db, apns, keyring }, job!.data.messageId, {
      lastAttempt: job!.retryCount >= PUSH_QUEUE_OPTIONS.retryLimit,
    });
    logger.info({ messageId: job!.data.messageId, outcome, attempt: job!.retryCount + 1 }, "push");
    return outcome;
  });

  return [...Object.values(QUEUES), PUSH_QUEUE];
}
