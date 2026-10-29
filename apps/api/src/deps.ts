import Anthropic from "@anthropic-ai/sdk";
import { createAppStoreClient, parseKeyring } from "@hshelby/core";
import { createDb } from "@hshelby/db";
import { createApnsClient } from "@hshelby/push";
import { createStorage, storageConfigFromEnv } from "@hshelby/storage";
import { createTelegramClient } from "@hshelby/telegram";
import pino from "pino";
import Stripe from "stripe";
import { createAuth } from "./auth";
import { createBilling } from "./billing";
import type { Deps } from "./context";
import { deriveDeviceTokenKey } from "./device-tokens";
import { aiEnabled, billingEnabled, type Env } from "./env";
import { createJobs } from "./jobs";
import { createRateLimiter } from "./rate-limit";

function storageFromEnv(env: Env) {
  const config = storageConfigFromEnv(env);
  return config ? createStorage(config) : null;
}

export function createDeps(
  env: Env,
  overrides: Partial<Pick<Deps, "appStore" | "logger" | "apns" | "storage" | "appStoreRoots" | "anthropic">> & { stripe?: Stripe } = {},
) {
  const logger =
    overrides.logger ??
    pino({ level: env.NODE_ENV === "test" ? "silent" : env.LOG_LEVEL, base: { service: "api" } });
  const { db, pool } = createDb(env.DATABASE_URL);
  const stripe = billingEnabled(env) ? (overrides.stripe ?? new Stripe(env.STRIPE_SECRET_KEY!)) : null;
  const billing = createBilling({ db, env, stripe, logger });
  const deps: Deps = {
    db,
    env,
    logger,
    keyring: parseKeyring(env.ENC_KEYS),
    appStore: overrides.appStore ?? createAppStoreClient({ country: env.APP_STORE_COUNTRY }),
    auth: createAuth({ db, env, logger, stripe, billing }),
    billing,
    deviceTokenKey: deriveDeviceTokenKey(env.BETTER_AUTH_SECRET),
    jobs: createJobs(env.DATABASE_URL, logger, { aiDebounceMs: env.AI_DEBOUNCE_MS }),
    apns: overrides.apns ?? createApnsClient(),
    storage: overrides.storage !== undefined ? overrides.storage : storageFromEnv(env),
    telegram: createTelegramClient({ baseUrl: env.TELEGRAM_API_URL }),
    appStoreRoots: overrides.appStoreRoots,
    anthropic:
      overrides.anthropic !== undefined
        ? overrides.anthropic
        : aiEnabled(env)
          ? new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, baseURL: env.ANTHROPIC_BASE_URL, maxRetries: 3, timeout: 90_000 })
          : null,
    rateLimiter: createRateLimiter(env.RATE_LIMIT_SCALE),
  };
  return { deps, pool };
}
