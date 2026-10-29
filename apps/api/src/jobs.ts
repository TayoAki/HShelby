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
import { fromDrizzle, PgBoss } from "pg-boss";
import type { Logger } from "pino";

export type Jobs = ReturnType<typeof createJobs>;

/** Background work the API hands to the worker. The API only enqueues; the worker runs jobs and schedules. */
export function createJobs(connectionString: string, logger: Logger) {
  const boss = new PgBoss({ connectionString, schema: "pgboss", supervise: false, schedule: false, max: 3 });
  boss.on("error", (err) => logger.error({ err }, "pg-boss error"));
  return {
    async start() {
      await boss.start();
      await boss.createQueue(PUSH_QUEUE, PUSH_QUEUE_OPTIONS);
      await boss.createQueue(TEAM_NOTIFY_QUEUE, TEAM_NOTIFY_QUEUE_OPTIONS);
      await boss.createQueue(TELEGRAM_QUEUE, TELEGRAM_QUEUE_OPTIONS);
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
  };
}
