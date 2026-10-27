import { createDb } from "@hshelby/db";
import { PgBoss } from "pg-boss";
import pino from "pino";
import { runCleanup } from "./jobs/cleanup";

const logger = pino({ level: process.env.LOG_LEVEL ?? "info", base: { service: "worker" } });
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");

const { db, pool } = createDb(connectionString, { max: 5 });
const boss = new PgBoss({ connectionString, schema: "pgboss" });
boss.on("error", (err) => logger.error({ err }, "pg-boss error"));

const QUEUES = { cleanup: "maintenance.cleanup" } as const;

await boss.start();
await boss.createQueue(QUEUES.cleanup);
// 03:00 UTC daily; pg-boss keeps one schedule per name across worker replicas.
await boss.schedule(QUEUES.cleanup, "0 3 * * *", null, { tz: "UTC" });

await boss.work(QUEUES.cleanup, async () => {
  const removed = await runCleanup(db);
  logger.info({ removed }, "cleanup finished");
  return removed;
});

logger.info({ queues: Object.values(QUEUES) }, "worker started");

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, async () => {
    logger.info({ signal }, "worker stopping");
    await boss.stop({ graceful: true, timeout: 20_000 });
    await pool.end();
    process.exit(0);
  });
}
