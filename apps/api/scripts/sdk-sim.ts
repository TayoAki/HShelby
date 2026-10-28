/**
 * Plays the iOS SDK against a running API, so messaging can be tried without an app:
 *
 *   npx tsx apps/api/scripts/sdk-sim.ts --app app_… --api http://localhost:8080 --say "Hello" --chat
 *
 * --say sends a message (repeatable). --chat keeps running: type lines to send them, and team replies
 * print as they arrive. The device secret is kept in .sdk-sim/<app>.json, so later runs continue the
 * same conversation; --new-device starts over as a new user.
 */
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { parseArgs } from "node:util";
import type { AccessToken, DeviceSession, SdkMessage, SdkSendResult, SdkSync } from "@hshelby/contracts";

const { values: args } = parseArgs({
  options: {
    api: { type: "string", default: "http://localhost:8080" },
    app: { type: "string" },
    say: { type: "string", multiple: true, default: [] },
    chat: { type: "boolean", default: false },
    "new-device": { type: "boolean", default: false },
    model: { type: "string", default: "iPhone16,1" },
  },
});
if (!args.app) {
  console.error("Usage: sdk-sim.ts --app app_… [--api URL] [--say TEXT]… [--chat] [--new-device]");
  process.exit(1);
}
const api = args.api.replace(/\/$/, "");
const statePath = `.sdk-sim/${args.app}.json`;

type State = { api: string; deviceSecret: string };
let accessToken = "";

async function request<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  const res = await fetch(`${api}${path}`, {
    ...init,
    headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}`, ...init.headers },
  });
  if (res.status === 401 && retry && !path.startsWith("/v1/session") && !path.startsWith("/v1/devices")) {
    await refresh();
    return request(path, init, false);
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${init.method ?? "GET"} ${path} → ${res.status} ${JSON.stringify(body)}`);
  return body as T;
}

async function register() {
  const session = await request<DeviceSession>("/v1/devices", {
    method: "POST",
    body: JSON.stringify({
      appId: args.app,
      device: {
        model: args.model,
        osVersion: "18.1",
        appVersion: "1.0.0",
        sdkVersion: "sim-0.1",
        locale: Intl.DateTimeFormat().resolvedOptions().locale,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
    }),
  });
  mkdirSync(".sdk-sim", { recursive: true });
  writeFileSync(statePath, JSON.stringify({ api, deviceSecret: session.deviceSecret } satisfies State, null, 2));
  accessToken = session.accessToken;
  console.log(`Registered a new device (secret saved to ${statePath}).`);
}

async function refresh() {
  const state = JSON.parse(readFileSync(statePath, "utf8")) as State;
  try {
    accessToken = (await request<AccessToken>("/v1/session/refresh", {
      method: "POST",
      body: JSON.stringify({ deviceSecret: state.deviceSecret }),
    })).accessToken;
  } catch {
    console.log("The saved device is gone; registering again.");
    await register();
  }
}

const print = (m: SdkMessage) => console.log(`${m.sender === "user" ? "  you" : " team"} │ ${m.text}`);

let lastSeq = 0;

async function sync() {
  const page = await request<SdkSync>(`/v1/conversation?after=${lastSeq}&limit=100`);
  for (const m of page.messages) {
    print(m);
    lastSeq = Math.max(lastSeq, m.seq);
  }
  if (page.conversation && page.conversation.unread > 0) {
    await request("/v1/read", { method: "POST", body: JSON.stringify({ seq: lastSeq }) });
  }
}

async function send(text: string) {
  const { message } = await request<SdkSendResult>("/v1/messages", {
    method: "POST",
    body: JSON.stringify({ clientId: randomUUID(), text }),
  });
  lastSeq = Math.max(lastSeq, message.seq);
}

const fresh = args["new-device"] || !existsSync(statePath) || (JSON.parse(readFileSync(statePath, "utf8")) as State).api !== api;
if (fresh) await register();
else await refresh();

const history = await request<SdkSync>("/v1/conversation?limit=20");
history.messages.forEach(print);
lastSeq = history.messages.at(-1)?.seq ?? 0;

for (const text of args.say) {
  await send(text);
  console.log(`  you │ ${text}`);
}

if (args.chat) {
  console.log("Chatting: type a message and press Enter. Ctrl+C to quit.");
  setInterval(() => sync().catch((err: unknown) => console.error(String(err))), 3000);
  createInterface({ input: process.stdin }).on("line", (line) => {
    const text = line.trim();
    if (text) send(text).catch((err: unknown) => console.error(String(err)));
  });
}
