import type { Keyring } from "@hshelby/core";
import type { Db } from "@hshelby/db";
import { deliverMessagePush, PUSH_QUEUE, PUSH_QUEUE_OPTIONS, type ApnsClient, type PushJob } from "@hshelby/push";
import type { Storage } from "@hshelby/storage";
import {
  DEFAULT_CHAT_INTERVAL_MS,
  scheduleNotify,
  sendTelegramJob,
  TEAM_NOTIFY_QUEUE,
  TEAM_NOTIFY_QUEUE_OPTIONS,
  TELEGRAM_QUEUE,
  TELEGRAM_QUEUE_OPTIONS,
  type TeamNotifyJob,
  type TelegramClient,
  type TelegramJob,
} from "@hshelby/telegram";
import type { Job, JobResult, JobWithMetadata, PgBoss } from "pg-boss";
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

/**
 * For queues that see bursts: up to 10 jobs per fetch, fetched back to back while the queue keeps returning
 * full batches (pg-boss otherwise waits for its 30 s backstop poll after a NOTIFY wake-up), each job settled
 * on its own so one failure retries only that job.
 */
const BURSTY = { batchSize: 10, burstWhenBatchFull: true, perJobResults: true } as const;

export type WorkerDeps = {
  db: Db;
  boss: PgBoss;
  apns: ApnsClient;
  keyring: Keyring;
  storage: Storage | null;
  /** For the billing backstop; null when billing is off. */
  stripe: Stripe | null;
  telegram: TelegramClient;
  /** Minimum gap between the bot's posts in one chat (tests shorten it). */
  telegramIntervalMs?: number;
  logger: Logger;
};

/** Creates the queues and schedules, and starts working them. */
export async function startWorker({ db, boss, apns, keyring, storage, stripe, telegram, telegramIntervalMs = DEFAULT_CHAT_INTERVAL_MS, logger }: WorkerDeps) {
  /**
   * Runs a batch job by job (or all at once with `parallel`): a thrown error fails that job alone. A batch
   * comes back in no particular order, so ordered queues sort it first.
   */
  const eachJob =
    <T, J extends Job<T> = Job<T>>(
      queue: string,
      handle: (job: J) => Promise<unknown>,
      { parallel = false, order }: { parallel?: boolean; order?: (a: J, b: J) => number } = {},
    ) =>
    async (batch: J[]): Promise<JobResult[]> => {
      const jobs = order ? [...batch].sort(order) : batch;
      const run = async (job: J): Promise<JobResult> => {
        try {
          return { id: job.id, status: "completed", output: await handle(job) };
        } catch (err) {
          logger.warn({ err, queue, jobId: job.id, attempt: job.retryCount + 1 }, "job failed");
          return { id: job.id, status: "failed", output: { message: err instanceof Error ? err.message : String(err) } };
        }
      };
      if (parallel) return Promise.all(jobs.map(run));
      const results: JobResult[] = [];
      for (const job of jobs) results.push(await run(job));
      return results;
    };

  await boss.start();
  for (const queue of Object.values(QUEUES)) await boss.createQueue(queue);
  await boss.createQueue(PUSH_QUEUE, PUSH_QUEUE_OPTIONS);
  await boss.createQueue(TEAM_NOTIFY_QUEUE, TEAM_NOTIFY_QUEUE_OPTIONS);
  await boss.createQueue(TELEGRAM_QUEUE, TELEGRAM_QUEUE_OPTIONS);
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
  await boss.work(
    PUSH_QUEUE,
    { ...BURSTY, localConcurrency: 2 },
    eachJob<PushJob>(
      PUSH_QUEUE,
      async (job) => {
        const outcome = await deliverMessagePush({ db, apns, keyring }, job.data.messageId, {
          lastAttempt: job.retryCount >= PUSH_QUEUE_OPTIONS.retryLimit,
        });
        logger.info({ messageId: job.data.messageId, outcome, attempt: job.retryCount + 1 }, "push");
        return outcome;
      },
      { parallel: true },
    ),
  );

  // A stored message for the team: if the app posts to Telegram, schedule the post into the chat's next slot.
  // in order, so a burst's slots follow the messages' order
  await boss.work(
    TEAM_NOTIFY_QUEUE,
    { ...BURSTY, includeMetadata: true },
    eachJob<TeamNotifyJob, JobWithMetadata<TeamNotifyJob>>(
      TEAM_NOTIFY_QUEUE,
      (job) =>
        scheduleNotify(
          db,
          job.data,
          (next, startAfter, singletonKey) => boss.send(TELEGRAM_QUEUE, next, { startAfter, singletonKey }),
          telegramIntervalMs,
        ),
      { order: (a, b) => a.createdOn.getTime() - b.createdOn.getTime() },
    ),
  );

  // Sends to one chat are paced inside sendTelegramJob; a 429 is rescheduled after Telegram's retry_after.
  // One worker taking jobs in creation (= slot) order keeps a chat's posts in the order they were written.
  // Scheduled jobs come due without a NOTIFY, so this queue polls every second.
  await boss.work(
    TELEGRAM_QUEUE,
    { ...BURSTY, includeMetadata: true, pollingIntervalSeconds: 1 },
    eachJob<TelegramJob, JobWithMetadata<TelegramJob>>(TELEGRAM_QUEUE, async (job) => {
      const outcome = await sendTelegramJob({ db, telegram, keyring, intervalMs: telegramIntervalMs }, job.data, {
        lastAttempt: job.retryCount >= TELEGRAM_QUEUE_OPTIONS.retryLimit,
      });
      if (typeof outcome === "object") {
        await boss.send(TELEGRAM_QUEUE, job.data, { startAfter: new Date(Date.now() + outcome.retryAfter * 1000) });
      }
      logger.info({ kind: job.data.kind, outcome }, "telegram");
      return outcome;
    }, { order: (a, b) => a.startAfter.getTime() - b.startAfter.getTime() || a.createdOn.getTime() - b.createdOn.getTime() }),
  );

  return [...Object.values(QUEUES), PUSH_QUEUE, TEAM_NOTIFY_QUEUE, TELEGRAM_QUEUE];
}
