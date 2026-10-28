import { randomBytes, randomUUID } from "node:crypto";
import type { AppStoreResult } from "@hshelby/contracts";
import type { AppStoreClient } from "@hshelby/core";
import { expect } from "vitest";
import { createApp } from "../src/app";
import { createDeps } from "../src/deps";
import { loadEnv } from "../src/env";

export const ORIGIN = "http://localhost:3000";

export const fakeAppStore: AppStoreClient & { results: AppStoreResult[] } = {
  results: [
    {
      appStoreId: "6700000001",
      name: "LockdList",
      iconUrl: "https://example.com/icon.png",
      bundleId: "com.example.lockdlist",
      sellerName: "Example LLC",
      url: "https://apps.apple.com/us/app/lockdlist/id6700000001",
      genre: "Productivity",
    },
  ],
  async search() {
    return this.results;
  },
  async lookup(id) {
    return this.results.find((r) => r.appStoreId === id) ?? null;
  },
};

export function makeTestApp() {
  const env = loadEnv({
    NODE_ENV: "test",
    DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgres://postgres@localhost:5433/hshelby_test",
    BETTER_AUTH_URL: ORIGIN,
    BETTER_AUTH_SECRET: randomBytes(32).toString("base64"),
    ENC_KEYS: `v1:${randomBytes(32).toString("base64")}`,
    PUBLIC_API_URL: "https://api.test",
  });
  const { deps, pool } = createDeps(env, { appStore: fakeAppStore });
  return { app: createApp(deps), deps, pool };
}

type TestApp = ReturnType<typeof makeTestApp>["app"];

/** Signs up a fresh user and returns a fetch helper that sends their session cookie. */
export async function signUp(app: TestApp, name = "Ada Lovelace") {
  const email = `${name.split(" ")[0]!.toLowerCase()}-${randomBytes(4).toString("hex")}@example.com`;
  const res = await app.request("/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN },
    body: JSON.stringify({ name, email, password: "correct horse battery" }),
  });
  if (res.status !== 200) throw new Error(`sign-up failed: ${res.status} ${await res.text()}`);
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  const call = (path: string, init: RequestInit = {}) =>
    app.request(path, {
      ...init,
      headers: { cookie, origin: ORIGIN, "content-type": "application/json", ...(init.headers ?? {}) },
    });
  return { email, cookie, call };
}

export type TeamCall = Awaited<ReturnType<typeof signUp>>["call"];

/** A signed-up owner with one app in their workspace. */
export async function workspaceWithApp(app: TestApp, name = "Ada Lovelace") {
  const team = await signUp(app, name);
  const res = await team.call("/api/apps", { method: "POST", body: JSON.stringify({ name: `${name}'s app` }) });
  const { app: created } = (await res.json()) as { app: { id: string; publicId: string } };
  return { ...team, appId: created.id, publicId: created.publicId };
}

/**
 * Registers a device the way the SDK does (`extra` adds to the registration body) and returns
 * helpers that call /v1 with its access token.
 */
export async function registerDevice(app: TestApp, publicId: string, extra: Record<string, unknown> = {}) {
  const res = await app.request("/v1/devices", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ appId: publicId, device: { model: "iPhone16,1" }, ...extra }),
  });
  expect(res.status).toBe(201);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- asserted on by the tests
  const session = (await res.json()) as any;
  let token: string = session.accessToken;
  const sdk = (path: string, init: RequestInit & { json?: unknown } = {}) =>
    app.request(path, {
      ...init,
      ...(init.json !== undefined ? { method: init.method ?? "POST", body: JSON.stringify(init.json) } : {}),
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    });
  const send = (text: string, clientId: string = randomUUID()) => sdk("/v1/messages", { json: { clientId, text } });
  return { session, sdk, send, setToken: (t: string) => (token = t) };
}

export const reply = (call: TeamCall, conversationId: string, text: string, clientId = randomUUID()) =>
  call(`/api/conversations/${conversationId}/messages`, { method: "POST", body: JSON.stringify({ clientId, text }) });
