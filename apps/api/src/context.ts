import type { AppStoreClient, Keyring } from "@hshelby/core";
import type { Db, devices } from "@hshelby/db";
import type { ApnsClient } from "@hshelby/push";
import type { Storage } from "@hshelby/storage";
import type { Logger } from "pino";
import type { Auth } from "./auth";
import type { Env } from "./env";
import type { Jobs } from "./jobs";

export type Deps = {
  db: Db;
  env: Env;
  auth: Auth;
  logger: Logger;
  keyring: Keyring;
  appStore: AppStoreClient;
  /** HS256 key for SDK access tokens. */
  deviceTokenKey: Uint8Array;
  jobs: Jobs;
  /** For "Send test"; regular pushes go out from the worker. */
  apns: ApnsClient;
  /** Photo storage; null when no bucket is configured. */
  storage: Storage | null;
};

type SessionResult = NonNullable<Awaited<ReturnType<Auth["api"]["getSession"]>>>;

export type AppEnv = {
  Variables: {
    requestId: string;
    user: SessionResult["user"];
    session: SessionResult["session"];
    org: { id: string; role: string };
  };
};

/** Context for the SDK routes under /v1, authenticated by a device access token. */
export type SdkEnv = {
  Variables: {
    requestId: string;
    device: typeof devices.$inferSelect;
    app: { id: string; organizationId: string; onlyVerified: boolean; identitySecretEnc: string };
  };
};
