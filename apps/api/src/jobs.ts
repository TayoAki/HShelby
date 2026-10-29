import type { Db, Tx } from "@hshelby/db";
import { PUSH_QUEUE, PUSH_QUEUE_OPTIONS, type PushJob } from "@hshelby/push";
import {
  TEAM_NOTIFY_QUEUE,
  TEAM_NOTIFY_QUEUE_OPTIONS,
  TELEGRAM_QUEUE,
  TELEGRAM_QUEUE_OPTIONS,
  type TeamNotifyJob,
  type TelegramJob,
} from "@hshelby/telegram";
import { sql } from "drizzle-orm";
import { fromDrizzle, PgBoss, type Job, type JobResult } from "pg-boss";
import type { Logger } from "pino";

export type Jobs = ReturnType<typeof createJobs>;

/** A subscription event for matched devices: start or resume their automations (phase B10). */
export const AUTOMATION_EVENT_QUEUE = "automation.event";
/** A run whose wait is over: send its next steps. */
export const AUTOMATION_STEP_QUEUE = "automation.step";
const AUTOMATION_QUEUE_OPTIONS = { retryLimit: 3, retryDelay: 10, retryBackoff: true, notify: true } as const;

export type AutomationEventJob = { appId: string; deviceIds: string[]; event: string };
export type AutomationStepJob = { runId: string };

/**
 * Background work. The API enqueues push, Telegram and team notifications for the worker, which talks to those
 * services. Automation jobs only write messages through the same code as replies, so the API process runs them
 * (`workAutomations`, started by the server, not by tests).
 */
export function createJobs(connectionString: string, logger: Logger) {
  const boss = new PgBoss({ connectionString, schema: "pgboss", supervise: false, schedule: false, max: 3 });
  boss.on("error", (err) => logger.error({ err }, "pg-boss error"));
  return {
    async start() {
      await boss.start();
      await boss.createQueue(PUSH_QUEUE, PUSH_QUEUE_OPTIONS);
      await boss.createQueue(TEAM_NOTIFY_QUEUE, TEAM_NOTIFY_QUEUE_OPTIONS);
      await boss.createQueue(TELEGRAM_QUEUE, TELEGRAM_QUEUE_OPTIONS);
      await boss.createQueue(AUTOMATION_EVENT_QUEUE, AUTOMATION_QUEUE_OPTIONS);
      await boss.createQueue(AUTOMATION_STEP_QUEUE, AUTOMATION_QUEUE_OPTIONS);
    },
    stop: () => boss.stop({ graceful: false }),
    /** Runs inside the reply's transaction, so a rolled-back message never notifies anyone. */
    async pushMessage(tx: Tx, messageId: string) {
      const job: PushJob = { messageId };
      await boss.send(PUSH_QUEUE, job, { db: fromDrizzle(tx, sql), singletonKey: messageId });
    },
    /** Tells the team's Telegram about a message (phase B8); the worker decides whether there's anywhere to post. */
    async notifyTeam(tx: Tx, messageId: string) {
      const job: TeamNotifyJob = { messageId };
      await boss.send(TEAM_NOTIFY_QUEUE, job, { db: fromDrizzle(tx, sql), singletonKey: messageId });
    },
    /** A Telegram call at its chat's reserved slot (see `reserveSlot`). */
    async telegramSend(tx: Db | Tx, job: TelegramJob, startAfter: Date) {
      await boss.send(TELEGRAM_QUEUE, job, { db: fromDrizzle(tx, sql), startAfter });
    },
    /** In the provider event's transaction, so an event that's rolled back starts nothing. */
    async automationEvent(tx: Db | Tx, job: AutomationEventJob) {
      await boss.send(AUTOMATION_EVENT_QUEUE, job, { db: fromDrizzle(tx, sql) });
    },
    /** Wakes a run when its wait ends (keyed by run and time, so one wake per wait). */
    async automationStep(tx: Db | Tx, runId: string, startAfter: Date) {
      const job: AutomationStepJob = { runId };
      await boss.send(AUTOMATION_STEP_QUEUE, job, { db: fromDrizzle(tx, sql), startAfter, singletonKey: `${runId}:${startAfter.getTime()}` });
    },
    /** Works the automation queues in this process, one job at a time per batch entry, each settled alone. */
    async workAutomations(handlers: { event: (job: AutomationEventJob) => Promise<unknown>; step: (job: AutomationStepJob) => Promise<unknown> }) {
      const each =
        <T>(handle: (data: T) => Promise<unknown>) =>
        async (jobs: Job<T>[]): Promise<JobResult[]> => {
          const results: JobResult[] = [];
          for (const job of jobs) {
            try {
              results.push({ id: job.id, status: "completed", output: await handle(job.data) });
            } catch (err) {
              logger.warn({ err, jobId: job.id }, "automation job failed");
              results.push({ id: job.id, status: "failed", output: { message: err instanceof Error ? err.message : String(err) } });
            }
          }
          return results;
        };
      // a wait ends without a NOTIFY, so poll often enough that "10:00" means within seconds of 10:00
      const options = { batchSize: 10, burstWhenBatchFull: true, perJobResults: true, pollingIntervalSeconds: 5, notifyPollingIntervalSeconds: 10 } as const;
      await boss.work(AUTOMATION_EVENT_QUEUE, options, each(handlers.event));
      await boss.work(AUTOMATION_STEP_QUEUE, options, each(handlers.step));
    },
  };
}
