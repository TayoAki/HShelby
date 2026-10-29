import { parseKeyring } from "@hshelby/core";
import { createDb } from "@hshelby/db";
import { createApnsClient } from "@hshelby/push";
import { createStorage, storageConfigFromEnv } from "@hshelby/storage";
import { createTelegramClient, DEFAULT_CHAT_INTERVAL_MS } from "@hshelby/telegram";
import { PgBoss } from "pg-boss";
import pino from "pino";
import Stripe from "stripe";
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

// billing backstop: optional, and test mode only, like in the API
const stripeKey = process.env.STRIPE_SECRET_KEY?.trim();
if (stripeKey?.startsWith("sk_live_")) throw new Error("Refusing to start with a live Stripe key: Stripe runs in test mode only.");
const stripe = stripeKey ? new Stripe(stripeKey) : null;

// Telegram: posts customer messages to the chats apps connected (decrypting their bot tokens with ENC_KEYS)
const telegram = createTelegramClient({ baseUrl: process.env.TELEGRAM_API_URL });
const telegramIntervalMs = Number(process.env.TELEGRAM_CHAT_INTERVAL_MS ?? DEFAULT_CHAT_INTERVAL_MS);

const queues = await startWorker({ db, boss, apns, keyring: parseKeyring(process.env.ENC_KEYS), storage, stripe, telegram, telegramIntervalMs, logger });
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
