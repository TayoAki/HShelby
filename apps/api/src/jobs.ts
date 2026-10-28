import type { Tx } from "@hshelby/db";
import { PUSH_QUEUE, PUSH_QUEUE_OPTIONS, type PushJob } from "@hshelby/push";
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
    },
    stop: () => boss.stop({ graceful: false }),
    /** Runs inside the reply's transaction, so a rolled-back message never notifies anyone. */
    async pushMessage(tx: Tx, messageId: string) {
      const job: PushJob = { messageId };
      await boss.send(PUSH_QUEUE, job, { db: fromDrizzle(tx, sql), singletonKey: messageId });
    },
  };
}
