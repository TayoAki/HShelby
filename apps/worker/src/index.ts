import { parseKeyring } from "@hshelby/core";
import { createDb } from "@hshelby/db";
import { createApnsClient } from "@hshelby/push";
import { createStorage, storageConfigFromEnv } from "@hshelby/storage";
import { PgBoss } from "pg-boss";
import pino from "pino";
import { startWorker } from "./worker";

const logger = pino({ level: process.env.LOG_LEVEL ?? "info", base: { service: "worker" } });
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");
// decrypts apps' APNs keys; the same keyring as the API's
if (!process.env.ENC_KEYS) throw new Error("ENC_KEYS is required");

const { db, pool } = createDb(connectionString, { max: 5 });
const apns = createApnsClient();
// listen/notify: a reply's push job wakes the worker at once instead of on the next poll
const boss = new PgBoss({ connectionString, schema: "pgboss", useListenNotify: true });
boss.on("error", (err) => logger.error({ err }, "pg-boss error"));

// photos: optional, like in the API
const storageConfig = storageConfigFromEnv(process.env);
const storage = storageConfig ? createStorage(storageConfig) : null;

const queues = await startWorker({ db, boss, apns, keyring: parseKeyring(process.env.ENC_KEYS), storage, logger });
logger.info({ queues }, "worker started");

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, async () => {
    logger.info({ signal }, "worker stopping");
    await boss.stop({ graceful: true, timeout: 20_000 });
    apns.close();
    await pool.end();
    process.exit(0);
  });
}
