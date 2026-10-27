import type { AppStoreClient, Keyring } from "@hshelby/core";
import type { Db } from "@hshelby/db";
import type { Logger } from "pino";
import type { Auth } from "./auth";
import type { Env } from "./env";

export type Deps = {
  db: Db;
  env: Env;
  auth: Auth;
  logger: Logger;
  keyring: Keyring;
  appStore: AppStoreClient;
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
