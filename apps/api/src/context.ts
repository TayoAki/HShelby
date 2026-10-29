import type Anthropic from "@anthropic-ai/sdk";
import type { AppStoreClient, Keyring } from "@hshelby/core";
import type { Db, devices } from "@hshelby/db";
import type { ApnsClient } from "@hshelby/push";
import type { Storage } from "@hshelby/storage";
import type { TelegramClient } from "@hshelby/telegram";
import type { Logger } from "pino";
import type { Auth } from "./auth";
import type { Billing } from "./billing";
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
  billing: Billing;
  /** Telegram connections are set up from the API; posts go out from the worker. */
  telegram: TelegramClient;
  /** Roots trusted for App Store notifications: Apple's unless a test passes its own. */
  appStoreRoots?: string[];
  /** Claude for AI replies; null without ANTHROPIC_API_KEY. */
  anthropic: Anthropic | null;
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
    app: {
      id: string;
      organizationId: string;
      onlyVerified: boolean;
      identitySecretEnc: string;
      appStoreId: string | null;
      showTeamPhotos: boolean;
      showTeamNames: boolean;
    };
  };
};
