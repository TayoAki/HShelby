import type { Keyring } from "@hshelby/core";
import type { Db } from "@hshelby/db";
import { deliverMessagePush, PUSH_QUEUE, PUSH_QUEUE_OPTIONS, type ApnsClient, type PushJob } from "@hshelby/push";
import type { Storage } from "@hshelby/storage";
import type { PgBoss } from "pg-boss";
import type { Logger } from "pino";
import type Stripe from "stripe";
import { syncSubscriptions } from "./jobs/billing";
import { runCleanup } from "./jobs/cleanup";
import { purgeDeletedApps } from "./jobs/purge";
import { removeUnsentUploads } from "./jobs/uploads";

const QUEUES = {
  cleanup: "maintenance.cleanup",
  purgeApps: "purge.deleted-apps",
  uploads: "maintenance.unsent-uploads",
  billing: "billing.sync",
} as const;

export type WorkerDeps = {
  db: Db;
  boss: PgBoss;
  apns: ApnsClient;
  keyring: Keyring;
  storage: Storage | null;
  /** For the billing backstop; null when billing is off. */
  stripe: Stripe | null;
  logger: Logger;
};

/** Creates the queues and schedules, and starts working them. */
export async function startWorker({ db, boss, apns, keyring, storage, stripe, logger }: WorkerDeps) {
  await boss.start();
  for (const queue of Object.values(QUEUES)) await boss.createQueue(queue);
  await boss.createQueue(PUSH_QUEUE, PUSH_QUEUE_OPTIONS);
  // pg-boss keeps one schedule per name across worker replicas.
  await boss.schedule(QUEUES.cleanup, "0 3 * * *", null, { tz: "UTC" });
  await boss.schedule(QUEUES.purgeApps, "*/15 * * * *", null, { tz: "UTC" });
  await boss.schedule(QUEUES.uploads, "23 * * * *", null, { tz: "UTC" });
  await boss.schedule(QUEUES.billing, "41 * * * *", null, { tz: "UTC" });

  await boss.work(QUEUES.cleanup, async () => {
    const removed = await runCleanup(db);
    logger.info({ removed }, "cleanup finished");
    return removed;
  });

  await boss.work(QUEUES.purgeApps, async () => {
    const purged = await purgeDeletedApps(db, storage);
    if (purged.apps > 0) logger.info({ purged }, "deleted apps purged");
    return purged;
  });

  await boss.work(QUEUES.uploads, async () => {
    if (!storage) return 0;
    const removed = await removeUnsentUploads(db, storage);
    if (removed > 0) logger.info({ removed }, "unsent uploads removed");
    return removed;
  });

  await boss.work(QUEUES.billing, async () => {
    if (!stripe) return null;
    const synced = await syncSubscriptions(db, stripe, logger);
    if (synced.fixed > 0) logger.info({ synced }, "billing synced");
    return synced;
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
