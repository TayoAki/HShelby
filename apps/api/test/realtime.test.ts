/* eslint-disable @typescript-eslint/no-explicit-any -- live events are asserted on, not typed */
import { randomBytes } from "node:crypto";
import { performance } from "node:perf_hooks";
import { afterAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { startServer } from "../src/server";
import { makeTestApp, ORIGIN, registerDevice, reply, workspaceWithApp } from "./helpers";

// two API instances on one database, sharing secrets like replicas of one service do
const shared = { BETTER_AUTH_SECRET: randomBytes(32).toString("base64"), ENC_KEYS: `v1:${randomBytes(32).toString("base64")}` };
const a = await makeTestApp({}, shared);
const b = await makeTestApp({}, shared);
const serverA = await startServer(a.deps, { port: 0, hostname: "127.0.0.1" });
const serverB = await startServer(b.deps, { port: 0, hostname: "127.0.0.1" });
const sockets: WebSocket[] = [];
afterAll(async () => {
  for (const ws of sockets) ws.terminate();
  await serverA.close();
  await serverB.close();
  await a.close();
  await b.close();
});

type Live = { ws: WebSocket; events: any[]; next: (match: (e: any) => boolean, timeoutMs?: number) => Promise<any> };

/** Opens a live socket and records what arrives; `next` waits for a matching event (already received or not). */
async function connect(port: number, path: string, headers: Record<string, string>): Promise<Live> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`, { headers });
  sockets.push(ws);
  const events: any[] = [];
  const waiters = new Set<{ match: (e: any) => boolean; resolve: (e: any) => void }>();
  ws.on("message", (data) => {
    const event = JSON.parse(String(data));
    events.push(event);
    for (const w of waiters) if (w.match(event)) (waiters.delete(w), w.resolve(event));
  });
  const next = (match: (e: any) => boolean, timeoutMs = 2000) =>
    new Promise<any>((resolve, reject) => {
      const seen = events.find(match);
      if (seen) return resolve(seen);
      const waiter = { match, resolve };
      waiters.add(waiter);
      setTimeout(() => (waiters.delete(waiter), reject(new Error(`no matching event; got ${JSON.stringify(events)}`))), timeoutMs);
    });
  await next((e) => e.type === "ready");
  return { ws, events, next };
}

/** What a refused upgrade answers. */
const refusal = (port: number, path: string, headers: Record<string, string> = {}) =>
  new Promise<number>((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`, { headers });
    ws.on("unexpected-response", (_req, res) => resolve(res.statusCode ?? 0));
    ws.on("open", () => (ws.close(), resolve(101)));
    ws.on("error", () => {});
  });

const teamSocket = (port: number, cookie: string) => connect(port, "/api/live", { cookie, origin: ORIGIN });
const sdkSocket = (port: number, token: string) => connect(port, "/v1/live", { authorization: `Bearer ${token}` });
const quiet = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A workspace on instance A whose user has written in. */
async function conversationOnA() {
  const team = await workspaceWithApp(a.app);
  const device = await registerDevice(a.app, team.publicId, { identity: { name: "Alex Rivera" } });
  const { conversation } = (await (await device.send("My lists stopped syncing")).json()) as any;
  return { team, device, token: device.session.accessToken as string, conversationId: conversation.id as string };
}

describe("fan-out across instances", () => {
  it("a reply sent through instance A reaches sockets on instance B in under 300 ms", async () => {
    const { team, token, conversationId } = await conversationOnA();
    const dashboard = await teamSocket(serverB.port, team.cookie);
    const phone = await sdkSocket(serverB.port, token);

    const start = performance.now();
    const res = await reply(team.call, conversationId, "Pull down on the list to refresh.");
    const [toDashboard, toPhone] = await Promise.all([
      dashboard.next((e) => e.type === "message" && e.sender === "agent"),
      phone.next((e) => e.type === "message" && e.seq === 2),
    ]);
    const elapsed = performance.now() - start;
    expect(res.status).toBe(201);
    expect(toDashboard).toEqual({ type: "message", conversationId, seq: 2, sender: "agent" });
    expect(toPhone).toEqual({ type: "message", seq: 2 });
    expect(elapsed).toBeLessThan(300);
  });

  it("delivers the user's messages and the team's read receipts", async () => {
    const { team, device, token, conversationId } = await conversationOnA();
    const dashboard = await teamSocket(serverB.port, team.cookie);
    const phone = await sdkSocket(serverA.port, token);

    await device.send("Still stuck");
    expect(await dashboard.next((e) => e.type === "message" && e.sender === "user")).toEqual({ type: "message", conversationId, seq: 2, sender: "user" });

    await team.call(`/api/conversations/${conversationId}/read`, { method: "POST", body: JSON.stringify({ seq: 2 }) });
    expect(await phone.next((e) => e.type === "read")).toEqual({ type: "read", seq: 2 });
    // the dashboard reloads the conversation's counters
    await dashboard.next((e) => e.type === "conversation" && e.conversationId === conversationId);
  });

  it("keeps each workspace's events to itself", async () => {
    const mine = await conversationOnA();
    const other = await conversationOnA();
    const dashboard = await teamSocket(serverB.port, mine.team.cookie);
    await reply(other.team.call, other.conversationId, "Not for you");
    await reply(mine.team.call, mine.conversationId, "For you");
    await dashboard.next((e) => e.type === "message" && e.conversationId === mine.conversationId);
    expect(dashboard.events.some((e) => e.conversationId === other.conversationId)).toBe(false);
  });

  it("tells sockets to catch up after the listener reconnects", async () => {
    const { team } = await conversationOnA();
    const dashboard = await teamSocket(serverB.port, team.cookie);
    serverB.gateway.fanout.simulateDrop();
    await dashboard.next((e) => e.type === "resync", 5000);
  });
});

describe("typing and presence", () => {
  it("relays typing both ways, never back to the one typing", async () => {
    const { team, token, conversationId } = await conversationOnA();
    const dashboard = await teamSocket(serverA.port, team.cookie);
    const sameTeammateElsewhere = await teamSocket(serverB.port, team.cookie);
    const phone = await sdkSocket(serverB.port, token);

    phone.ws.send(JSON.stringify({ type: "typing" }));
    expect(await dashboard.next((e) => e.type === "typing")).toEqual({ type: "typing", conversationId, sender: "user", name: "Alex Rivera", userId: null });

    dashboard.ws.send(JSON.stringify({ type: "typing", conversationId }));
    expect(await phone.next((e) => e.type === "typing")).toEqual({ type: "typing", name: "Ada" });
    await quiet(200);
    expect(sameTeammateElsewhere.events.filter((e) => e.type === "typing" && e.sender === "agent")).toEqual([]);

    // junk and other workspaces' conversations are ignored
    dashboard.ws.send("not json");
    dashboard.ws.send(JSON.stringify({ type: "typing", conversationId: (await conversationOnA()).conversationId }));
    await quiet(200);
    expect(dashboard.ws.readyState).toBe(WebSocket.OPEN);
  });

  it("shows the user In chat while their socket is open", async () => {
    const { team, token, conversationId } = await conversationOnA();
    const dashboard = await teamSocket(serverB.port, team.cookie);
    const inChat = async () => ((await (await team.call(`/api/conversations/${conversationId}`)).json()) as any).conversation.device.inChat;
    expect(await inChat()).toBe(false);

    const phone = await sdkSocket(serverA.port, token);
    expect(await dashboard.next((e) => e.type === "presence" && e.inChat)).toEqual({ type: "presence", conversationId, inChat: true });
    expect(await inChat()).toBe(true);

    phone.ws.close();
    await dashboard.next((e) => e.type === "presence" && !e.inChat);
    expect(await inChat()).toBe(false);
  });
});

describe("authentication", () => {
  it("refuses sockets without valid credentials", async () => {
    const { team } = await conversationOnA();
    expect(await refusal(serverA.port, "/v1/live")).toBe(401);
    expect(await refusal(serverA.port, "/v1/live", { authorization: "Bearer nope" })).toBe(401);
    expect(await refusal(serverA.port, "/api/live", { origin: ORIGIN })).toBe(401);
    // a session cookie from another site's page doesn't open a socket
    expect(await refusal(serverA.port, "/api/live", { cookie: team.cookie, origin: "https://evil.example" })).toBe(403);
    expect(await refusal(serverA.port, "/elsewhere")).toBe(404);
  });

  it("stops serving a device after it logs out", async () => {
    const { device, token } = await conversationOnA();
    await device.sdk("/v1/session/logout", { json: { deviceSecret: device.session.deviceSecret } });
    expect(await refusal(serverA.port, "/v1/live", { authorization: `Bearer ${token}` })).toBe(401);
  });
});
