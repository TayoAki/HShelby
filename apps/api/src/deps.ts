import { createAppStoreClient, parseKeyring } from "@hshelby/core";
import { createDb } from "@hshelby/db";
import { createApnsClient } from "@hshelby/push";
import pino from "pino";
import { createAuth } from "./auth";
import type { Deps } from "./context";
import { deriveDeviceTokenKey } from "./device-tokens";
import type { Env } from "./env";
import { createJobs } from "./jobs";

export function createDeps(env: Env, overrides: Partial<Pick<Deps, "appStore" | "logger" | "apns">> = {}) {
  const logger =
    overrides.logger ??
    pino({ level: env.NODE_ENV === "test" ? "silent" : env.LOG_LEVEL, base: { service: "api" } });
  const { db, pool } = createDb(env.DATABASE_URL);
  const deps: Deps = {
    db,
    env,
    logger,
    keyring: parseKeyring(env.ENC_KEYS),
    appStore: overrides.appStore ?? createAppStoreClient({ country: env.APP_STORE_COUNTRY }),
    auth: createAuth({ db, env, logger }),
    deviceTokenKey: deriveDeviceTokenKey(env.BETTER_AUTH_SECRET),
    jobs: createJobs(env.DATABASE_URL, logger),
    apns: overrides.apns ?? createApnsClient(),
  };
  return { deps, pool };
}
