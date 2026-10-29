/**
 * Plays the iOS SDK against a running API, so messaging and identity can be tried without an app:
 *
 *   npx tsx apps/api/scripts/sdk-sim.ts --app app_… --api http://localhost:8080 --say "Hello" --chat
 *
 * --say TEXT        send a message (repeatable)
 * --chat            keep running: type lines to send them; team replies and typing print as they arrive
 *                   (over the live WebSocket, with "In chat" heartbeats; polling only while it's down)
 * --user-id/--name/--email   identify() labels (unverified)
 * --verified        also send an identity token for those values, signed with $IDENTITY_SECRET the way the
 *                   developer's server would (env var, so the secret stays out of shell history)
 * --meta KEY=VALUE  setMetadata() (repeatable; replaces the whole set)
 * --photo PATH      send a JPEG or PNG through the upload flow (repeatable, up to 4; --caption adds text)
 * --push-token HEX  report an APNs device token (with --push-env sandbox|production, default sandbox),
 *                   so "Send test" and replies target this device
 * --paywall ID=TITLE  report a paywall the app can show (repeatable; replaces the list), so the team can send
 *                   offers for it. In --chat, type /tap to tap the latest card's button.
 * --track EVENT     track an event (repeatable), as the app does for automations; prints whether one sent a
 *                   message and asked to open the chat. In --chat, type /track EVENT.
 * --storekit-tx ID  report a StoreKit original transaction ID (repeatable), which App Store notifications match
 * --paying          report that StoreKit says the person pays
 * --logout          logout(): end this device; the next run registers a new one
 * --delete          deleteData(): remove this device and its history
 * --new-device      start over as a new install
 *
 * The device secret is kept in .sdk-sim/<app>.json, so later runs continue the same conversation.
 */
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createInterface, emitKeypressEvents } from "node:readline";
import { parseArgs } from "node:util";
import {
  LIVE_HEARTBEAT_MS,
  TYPING_TTL_MS,
  type AccessToken,
  type DeviceSession,
  type DeviceUpdateResult,
  type SdkIdentity,
  type SdkLiveEvent,
  type SdkMessage,
  type SdkSendResult,
  type SdkSync,
  type UploadTicket,
} from "@hshelby/contracts";
import { inspectImage } from "@hshelby/storage";
import { SignJWT } from "jose";
import WebSocket from "ws";

const { values: args } = parseArgs({
  options: {
    api: { type: "string", default: "http://localhost:8080" },
    app: { type: "string" },
    say: { type: "string", multiple: true, default: [] },
    chat: { type: "boolean", default: false },
    "new-device": { type: "boolean", default: false },
    model: { type: "string", default: "iPhone16,1" },
    "user-id": { type: "string" },
    name: { type: "string" },
    email: { type: "string" },
    verified: { type: "boolean", default: false },
    meta: { type: "string", multiple: true },
    photo: { type: "string", multiple: true, default: [] },
    caption: { type: "string", default: "" },
    "push-token": { type: "string" },
    "push-env": { type: "string", default: "sandbox" },
    paywall: { type: "string", multiple: true },
    track: { type: "string", multiple: true, default: [] },
    "storekit-tx": { type: "string", multiple: true },
    paying: { type: "boolean" },
    logout: { type: "boolean", default: false },
    delete: { type: "boolean", default: false },
  },
});
if (!args.app) {
  console.error(
    "Usage: sdk-sim.ts --app app_… [--api URL] [--say TEXT]… [--chat] [--user-id ID --name N --email E [--verified]] [--meta K=V]… [--paywall ID=TITLE]… [--logout | --delete] [--new-device]",
  );
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
  const body = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${init.method ?? "GET"} ${path} → ${res.status} ${JSON.stringify(body)}`);
  return body as T;
}

const readState = () => JSON.parse(readFileSync(statePath, "utf8")) as State;

/** Identity and metadata from the flags, shaped like the SDK's staged state. */
async function stagedState() {
  const labels = { userId: args["user-id"], name: args.name, email: args.email };
  const hasLabels = Object.values(labels).some(Boolean);
  let identityToken: string | undefined;
  if (args.verified) {
    const secret = process.env.IDENTITY_SECRET;
    if (!secret || !labels.userId) throw new Error("--verified needs --user-id and the IDENTITY_SECRET environment variable");
    identityToken = await new SignJWT({ user_id: labels.userId, name: labels.name, email: labels.email })
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime("7d")
      .sign(new TextEncoder().encode(secret));
  }
  const metadata = args.meta && Object.fromEntries(args.meta.map((kv) => [kv.slice(0, kv.indexOf("=")), kv.slice(kv.indexOf("=") + 1)]));
  const pushToken = args["push-token"];
  const paywalls = args.paywall?.map((kv) => {
    const [id, title] = kv.includes("=") ? [kv.slice(0, kv.indexOf("=")), kv.slice(kv.indexOf("=") + 1)] : [kv, kv];
    return { id, title, source: "app" };
  });
  return {
    ...(hasLabels && { identity: labels }),
    ...(identityToken && { identityToken }),
    ...(metadata && { metadata }),
    ...(pushToken && { push: { token: pushToken, environment: args["push-env"] } }),
    ...(paywalls && { paywalls }),
    ...((args["storekit-tx"] || args.paying !== undefined) && {
      storekit: { ...(args.paying !== undefined && { paying: args.paying }), ...(args["storekit-tx"] && { originalTransactionIds: args["storekit-tx"] }) },
    }),
  };
}

const describe = (identity: SdkIdentity) =>
  identity.userId || identity.name || identity.email
    ? `${identity.name ?? identity.email ?? identity.userId}${identity.verified ? " (verified)" : " (unverified)"}`
    : "anonymous";

async function register() {
  const session = await request<DeviceSession>("/v1/devices", {
    method: "POST",
    body: JSON.stringify({
      appId: args.app,
      device: {
        model: args.model,
        osVersion: "18.1",
        appVersion: "1.0.0",
        sdkVersion: "sim-0.2",
        locale: Intl.DateTimeFormat().resolvedOptions().locale,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
      ...(await stagedState()),
    }),
  });
  mkdirSync(".sdk-sim", { recursive: true });
  writeFileSync(statePath, JSON.stringify({ api, deviceSecret: session.deviceSecret } satisfies State, null, 2));
  accessToken = session.accessToken;
  console.log(`Registered a new device as ${describe(session.identity)} (secret saved to ${statePath}).`);
}

async function refresh() {
  try {
    accessToken = (await request<AccessToken>("/v1/session/refresh", {
      method: "POST",
      body: JSON.stringify({ deviceSecret: readState().deviceSecret }),
    })).accessToken;
  } catch {
    console.log("The saved device has ended (logged out or deleted); registering again.");
    await register();
  }
}

/** The latest card, for /tap. */
let lastCard: SdkMessage | null = null;

const cardButton = (m: SdkMessage) => {
  if (!m.card) return "";
  const card = m.card;
  if (card.type === "review") return card.url ? `[★ ${card.buttonLabel ?? "Rate on the App Store"}]` : "";
  const known = !args.paywall || args.paywall.some((kv) => kv.split("=")[0] === card.paywallId);
  return known ? `[${card.buttonLabel ?? "View offer"} → ${card.paywallId}]` : "[No longer available]";
};

const print = (m: SdkMessage) => {
  const photos = m.attachments.map((a) => `[photo ${a.width}×${a.height}]`).join(" ");
  if (m.card) lastCard = m;
  const tapped = m.actionClickedAt ? "(tapped)" : "";
  console.log(`${m.sender === "user" ? "  you" : m.byAi ? "   AI" : " team"} │ ${[photos, m.text, cardButton(m), tapped].filter(Boolean).join(" ")}`);
};

/** What the SDK does on a card tap: open the review page or the paywall, and send the click receipt. */
async function tapLastCard() {
  if (!lastCard?.card) return console.log("       (no card to tap)");
  const target = lastCard.card.type === "review" ? lastCard.card.url : `paywall ${lastCard.card.paywallId}`;
  const { first } = await request<{ first: boolean }>(`/v1/actions/${lastCard.id}/click`, { method: "POST" });
  console.log(`       (opened ${target}${first ? "" : "; already tapped before"})`);
}

/** The SDK's photo flow: an upload ticket for the exact bytes, a PUT straight to storage, then the message. */
async function sendPhotos(paths: string[], caption: string) {
  const attachmentIds: string[] = [];
  for (const path of paths) {
    const body = readFileSync(path);
    const info = inspectImage(body);
    if (!info) throw new Error(`${path} isn't a JPEG or PNG`);
    const ticket = await request<UploadTicket>("/v1/uploads", {
      method: "POST",
      body: JSON.stringify({
        contentType: info.contentType,
        bytes: body.length,
        width: info.width,
        height: info.height,
        checksum: createHash("sha256").update(body).digest("base64"),
      }),
    });
    const put = await fetch(ticket.uploadUrl, { method: ticket.method, headers: ticket.headers, body });
    if (!put.ok) throw new Error(`upload of ${path} failed: ${put.status} ${await put.text()}`);
    attachmentIds.push(ticket.attachmentId);
  }
  const { message } = await request<SdkSendResult>("/v1/messages", {
    method: "POST",
    body: JSON.stringify({ clientId: randomUUID(), text: caption, attachmentIds }),
  });
  lastSeq = Math.max(lastSeq, message.seq);
  print(message);
}

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

const saved = !args["new-device"] && existsSync(statePath) && readState().api === api;

if (args.logout || args.delete) {
  if (!saved) {
    console.log("No saved device for this app.");
    process.exit(0);
  }
  if (args.logout) {
    await request("/v1/session/logout", { method: "POST", body: JSON.stringify({ deviceSecret: readState().deviceSecret }) });
    console.log("Logged out: the device has ended; its history stays in the inbox.");
  } else {
    await refresh();
    await request("/v1/device", { method: "DELETE" });
    console.log("Deleted this device and its conversation.");
  }
  rmSync(statePath);
  process.exit(0);
}

if (saved) {
  await refresh();
  const staged = await stagedState();
  if (Object.keys(staged).length > 0) {
    const { identity } = await request<DeviceUpdateResult>("/v1/device", { method: "PATCH", body: JSON.stringify(staged) });
    console.log(`Updated the device: ${describe(identity)}.`);
  }
} else {
  await register();
}

const history = await request<SdkSync>("/v1/conversation?limit=20");
history.messages.forEach(print);
lastSeq = history.messages.at(-1)?.seq ?? 0;
if (!history.sending.allowed) console.log(`(sending is off: ${history.sending.reason})`);

for (const text of args.say) {
  await send(text);
  console.log(`  you │ ${text}`);
}

if (args.photo.length > 0) await sendPhotos(args.photo, args.caption);

/** What the SDK's track() does: the server runs automations listening for the event right away. */
async function trackEvent(event: string) {
  const outcome = await request<{ sent: boolean; openChat: boolean }>("/v1/track", { method: "POST", body: JSON.stringify({ event }) });
  console.log(`       (tracked ${event}: ${outcome.sent ? "an automation sent a message" : "nothing sent"}${outcome.openChat ? ", open the chat" : ""})`);
  if (outcome.sent) await sync();
}
for (const event of args.track) await trackEvent(event);

/** The SDK's live connection while the chat is open: events trigger a sync; polling covers the gaps. */
let socket: WebSocket | null = null;
function goLive() {
  const ws = new WebSocket(`${api.replace(/^http/, "ws")}/v1/live`, { headers: { authorization: `Bearer ${accessToken}` } });
  socket = ws;
  let heartbeat: NodeJS.Timeout | undefined;
  let typingShownAt = 0;
  ws.on("open", () => (heartbeat = setInterval(() => ws.send(JSON.stringify({ type: "heartbeat" })), LIVE_HEARTBEAT_MS)));
  ws.on("message", (data) => {
    const event = JSON.parse(String(data)) as SdkLiveEvent;
    if (event.type === "typing") {
      if (Date.now() - typingShownAt > TYPING_TTL_MS) console.log(` team │ (${event.name ?? "someone"} is typing…)`);
      typingShownAt = Date.now();
    } else if (event.type === "read") {
      console.log("       (seen by the team)");
    } else {
      sync().catch((err: unknown) => console.error(String(err)));
    }
  });
  ws.on("error", () => {});
  ws.on("close", (code) => {
    socket = null;
    clearInterval(heartbeat);
    // a closed or refused socket usually means the access token expired: refresh, then reconnect
    setTimeout(() => refresh().then(goLive, () => setTimeout(goLive, 5000)), code === 4001 ? 0 : 2000);
  });
}

if (args.chat) {
  console.log("Chatting: type a message and press Enter. Ctrl+C to quit.");
  goLive();
  setInterval(() => {
    if (socket?.readyState !== WebSocket.OPEN) sync().catch((err: unknown) => console.error(String(err)));
  }, 3000);
  let typingSentAt = 0;
  if (process.stdin.isTTY) {
    emitKeypressEvents(process.stdin);
    process.stdin.on("keypress", () => {
      if (Date.now() - typingSentAt < 2000 || socket?.readyState !== WebSocket.OPEN) return;
      typingSentAt = Date.now();
      socket.send(JSON.stringify({ type: "typing" }));
    });
  }
  createInterface({ input: process.stdin }).on("line", (line) => {
    const text = line.trim();
    if (text === "/tap") tapLastCard().catch((err: unknown) => console.error(String(err)));
    else if (text.startsWith("/track ")) trackEvent(text.slice(7).trim()).catch((err: unknown) => console.error(String(err)));
    else if (text) send(text).catch((err: unknown) => console.error(String(err)));
  });
}
