/* eslint-disable @typescript-eslint/no-explicit-any -- response bodies are asserted on, not typed */
import { automationRuns, conversations, devices } from "@hshelby/db";
import { revenueCatEvent } from "@hshelby/subscriptions/testing";
import { and, eq, sql } from "drizzle-orm";
import { PgBoss } from "pg-boss";
import { afterAll, describe, expect, it } from "vitest";
import { executeRun, onEvent } from "../src/automations/engine";
import { waitUntil } from "../src/automations/time";
import { AUTOMATION_EVENT_QUEUE, AUTOMATION_STEP_QUEUE, type AutomationEventJob } from "../src/jobs";
import { joinAsMember, makeTestApp, registerDevice, reply, workspaceWithApp } from "./helpers";

const { app, deps, close } = await makeTestApp();
const boss = new PgBoss({ connectionString: process.env.TEST_DATABASE_URL ?? "postgres://postgres@localhost:5433/hshelby_test", schema: "pgboss", supervise: false, schedule: false });
await boss.start();
await boss.deleteQueuedJobs(AUTOMATION_EVENT_QUEUE);
afterAll(async () => {
  await boss.stop({ graceful: false });
  await close();
});

type Team = Awaited<ReturnType<typeof workspaceWithApp>>;
type Device = Awaited<ReturnType<typeof registerDevice>>;

const PRO = { id: "exit-offer", title: "Exit offer 50%", source: "revenuecat" };
const base = { trigger: { event: "paywall_declined" }, steps: [{ type: "message", text: "Anything we can help with?" }] };

const create = async (team: Team, definition: Record<string, unknown>) => {
  const res = await team.call(`/api/apps/${team.appId}/automations`, { method: "POST", body: JSON.stringify({ name: "Test", enabled: true, ...base, ...definition }) });
  expect(res.status).toBe(201);
  return ((await res.json()) as any).automation;
};
const idOf = (device: Device) => JSON.parse(Buffer.from(device.session.accessToken.split(".")[1], "base64url").toString()).sub as string;
const track = async (device: Device, event = "paywall_declined") => (await (await device.sdk("/v1/track", { json: { event } })).json()) as any;
const sync = async (device: Device) => ((await (await device.sdk("/v1/conversation")).json()) as any).messages as any[];
const runsOf = (deviceId: string) => deps.db.select().from(automationRuns).where(eq(automationRuns.deviceId, deviceId));
const results = async (team: Team, automationId: string) =>
  (await (await team.call(`/api/apps/${team.appId}/automations/${automationId}/results`)).json()) as any;

describe("tracked events", () => {
  it("sends right away, opens the chat, and keeps the conversation out of the inbox until they reply", async () => {
    const team = await workspaceWithApp(app);
    await create(team, { steps: [{ type: "open_chat" }, { type: "message", text: "Before you go: anything missing?" }] });
    const device = await registerDevice(app, team.publicId);
    expect(await track(device)).toEqual({ sent: true, openChat: true });
    expect((await sync(device)).map((m) => [m.sender, m.text])).toEqual([["agent", "Before you go: anything missing?"]]);
    const inbox = async () => ((await (await team.call("/api/conversations?status=all")).json()) as any).conversations.length;
    expect(await inbox()).toBe(0);
    await device.send("Dark mode please");
    expect(await inbox()).toBe(1);
  });

  it("runs once per person by default, or every time after the previous run", async () => {
    const team = await workspaceWithApp(app);
    await create(team, {});
    const device = await registerDevice(app, team.publicId);
    expect((await track(device)).sent).toBe(true);
    expect((await track(device)).sent).toBe(false);

    const every = await workspaceWithApp(app, "Grace Hopper");
    await create(every, { trigger: { event: "paywall_declined", frequency: "every" }, audience: { duringConversation: true } });
    const other = await registerDevice(app, every.publicId);
    await track(other);
    await track(other);
    expect(await sync(other)).toHaveLength(2);
  });

  it("only listens for enabled automations' events, and refuses subscription event names", async () => {
    const team = await workspaceWithApp(app);
    await create(team, { trigger: { event: "checkout_cancelled" } });
    await create(team, { trigger: { event: "onboarding_completed" }, enabled: false });
    await create(team, { trigger: { event: "subscription_cancelled" } });
    const device = await registerDevice(app, team.publicId);
    expect(await (await device.sdk("/v1/track/events")).json()).toEqual({ events: ["checkout_cancelled"], ttlSeconds: 300 });
    expect((await device.sdk("/v1/track", { json: { event: "subscription_cancelled" } })).status).toBe(400);
    expect(await track(device, "nothing_listens")).toEqual({ sent: false, openChat: false });
  });
});

describe("who gets it", () => {
  it("checks the paying segment and metadata rules", async () => {
    const team = await workspaceWithApp(app);
    const automation = await create(team, { audience: { segment: "not_paying", rules: [{ key: "plan", op: "equals", value: "free" }] } });
    const free = await registerDevice(app, team.publicId, { metadata: { plan: "free" } });
    const pro = await registerDevice(app, team.publicId, { metadata: { plan: "free", subscription_status: "active" } });
    const other = await registerDevice(app, team.publicId, { metadata: { plan: "team" } });
    const storeKitPaying = await registerDevice(app, team.publicId, { metadata: { plan: "free" }, storekit: { paying: true } });
    for (const d of [free, pro, other, storeKitPaying]) await track(d);
    expect((await sync(free)).length).toBe(1);
    for (const d of [pro, other, storeKitPaying]) expect(await sync(d)).toEqual([]);
    expect((await results(team, automation.id)).skipped.map((s: any) => s.reason)).toEqual(["audience", "audience", "audience"]);
  });

  it("skips people in a conversation unless the automation says otherwise, and catches them later", async () => {
    const team = await workspaceWithApp(app);
    const automation = await create(team, {});
    const device = await registerDevice(app, team.publicId);
    await device.send("Hi, quick question");
    expect((await track(device)).sent).toBe(false);
    expect((await results(team, automation.id)).skipped[0]).toMatchObject({ reason: "ongoing_conversation", status: "skipped" });

    // a day later, the next event gets them
    await deps.db.update(conversations).set({ lastMessageAt: sql`now() - interval '25 hours'` }).where(eq(conversations.deviceId, idOf(device)));
    expect((await track(device)).sent).toBe(true);
  });
});

describe("offers, ratings and holds", () => {
  it("holds a run whose offer the device can't show, and sends it at the next event once it can", async () => {
    const team = await workspaceWithApp(app);
    const automation = await create(team, { steps: [{ type: "offer", paywallId: "exit-offer", text: "Here's 50% off" }] });
    const device = await registerDevice(app, team.publicId);
    expect((await track(device)).sent).toBe(false);
    expect((await results(team, automation.id)).skipped[0]).toMatchObject({ reason: "offer_unavailable", status: "held" });

    await device.sdk("/v1/device", { method: "PATCH", json: { paywalls: [PRO] } });
    expect((await track(device)).sent).toBe(true);
    const [offer] = await sync(device);
    expect(offer).toMatchObject({ kind: "paywall", text: "Here's 50% off", card: { type: "paywall", paywallId: "exit-offer" } });
    expect(await runsOf(idOf(device))).toHaveLength(1);

    // the tap counts as opened
    await device.sdk(`/v1/actions/${offer.id}/click`, { method: "POST" });
    expect(await results(team, automation.id)).toMatchObject({ sent: 1, opened: 1 });
  });

  it("asks for a rating once per person, and only with an App Store ID", async () => {
    const team = await workspaceWithApp(app);
    await create(team, { trigger: { event: "paywall_declined", frequency: "every" }, audience: { duringConversation: true }, steps: [{ type: "rating", text: "Enjoying {app}?" }] });
    const device = await registerDevice(app, team.publicId);
    expect((await track(device)).sent).toBe(false);
    await team.call(`/api/apps/${team.appId}`, { method: "PATCH", body: JSON.stringify({ appStoreId: "6700000042" }) });
    expect((await track(device)).sent).toBe(true);
    expect((await sync(device))[0]).toMatchObject({ kind: "review", text: "Enjoying Ada Lovelace's app?" });
    // already asked: held from now on
    expect((await track(device)).sent).toBe(false);
  });
});

describe("waits", () => {
  it("re-checks follow-ups after a wait: a reply ends the run", async () => {
    const team = await workspaceWithApp(app);
    const automation = await create(team, {
      audience: { duringConversation: true },
      steps: [
        { type: "message", text: "First" },
        { type: "wait", minutes: 60 },
        { type: "message", text: "Following up" },
      ],
    });
    const device = await registerDevice(app, team.publicId);
    await track(device);
    const [run] = await runsOf(idOf(device));
    expect(run).toMatchObject({ status: "scheduled", stepIndex: 2 });
    expect(run!.nextAt!.getTime() - Date.now()).toBeGreaterThan(59 * 60_000);

    await device.send("Thanks!");
    await executeRun(deps, run!.id);
    expect((await runsOf(idOf(device)))[0]).toMatchObject({ status: "ended", reason: "replied" });
    expect((await sync(device)).map((m) => m.text)).toEqual(["First", "Thanks!"]);
    expect(await results(team, automation.id)).toMatchObject({ sent: 1, replied: 1 });
  });

  it("sends the follow-up when nothing changed, exactly once even if the job runs twice", async () => {
    const team = await workspaceWithApp(app);
    await create(team, { steps: [{ type: "message", text: "First" }, { type: "wait", minutes: 5 }, { type: "message", text: "Second" }] });
    const device = await registerDevice(app, team.publicId);
    await track(device);
    const [run] = await runsOf(idOf(device));
    await Promise.all([executeRun(deps, run!.id), executeRun(deps, run!.id)]);
    expect((await sync(device)).map((m) => m.text)).toEqual(["First", "Second"]);
    expect((await runsOf(idOf(device)))[0]).toMatchObject({ status: "done" });
  });

  it("stops scheduled runs when the automation is switched off", async () => {
    const team = await workspaceWithApp(app);
    const automation = await create(team, { wait: { type: "delay", minutes: 30 } });
    const device = await registerDevice(app, team.publicId);
    await track(device);
    await team.call(`/api/apps/${team.appId}/automations/${automation.id}`, { method: "PUT", body: JSON.stringify({ name: "Test", ...base, wait: { type: "delay", minutes: 30 }, enabled: false }) });
    const [run] = await runsOf(idOf(device));
    await executeRun(deps, run!.id);
    expect((await runsOf(idOf(device)))[0]).toMatchObject({ status: "ended", reason: "disabled" });
    expect(await sync(device)).toEqual([]);
  });
});

/**
 * The done-when: "cancelled → offer tomorrow 10:00 local" fires at the right UTC time for people in three time
 * zones, starting from a real RevenueCat webhook.
 */
describe("subscription events and local time", () => {
  it("schedules a cancelled subscriber's offer for 10:00 tomorrow in each person's time zone", async () => {
    const team = await workspaceWithApp(app);
    await create(team, {
      trigger: { event: "subscription_cancelled" },
      wait: { type: "local_time", days: 1, time: "10:00" },
      steps: [{ type: "offer", paywallId: "exit-offer", text: "Come back for 50% off" }],
    });
    const { integrations } = (await (await team.call(`/api/apps/${team.appId}/integrations/revenuecat`, { method: "PUT", body: "{}" })).json()) as any;
    const authorization = integrations.find((i: any) => i.provider === "revenuecat").authorization;

    const zones = { "user-la": "America/Los_Angeles", "user-berlin": "Europe/Berlin", "user-tokyo": "Asia/Tokyo" } as const;
    const people: Record<string, Device> = {};
    for (const [userId, timezone] of Object.entries(zones)) {
      people[userId] = await registerDevice(app, team.publicId, { identity: { userId }, device: { timezone }, paywalls: [PRO] });
      const event = revenueCatEvent("CANCELLATION", { app_user_id: userId, original_app_user_id: userId, aliases: [userId], cancel_reason: "UNSUBSCRIBE" });
      const res = await app.request(`/webhooks/revenuecat/${team.publicId}`, { method: "POST", headers: { "content-type": "application/json", authorization }, body: JSON.stringify(event) });
      expect(res.status).toBe(200);
    }

    // the worker side: the webhook queued automation.event jobs in its transaction
    const now = new Date("2026-10-29T15:30:00Z");
    const jobs = await boss.fetch<AutomationEventJob>(AUTOMATION_EVENT_QUEUE, { batchSize: 10 });
    expect(jobs).toHaveLength(3);
    for (const job of jobs) await onEvent(deps, { ...job.data, now });
    await boss.complete(AUTOMATION_EVENT_QUEUE, jobs.map((j) => j.id));

    const expected = { "user-la": "2026-10-30T17:00:00.000Z", "user-berlin": "2026-10-30T09:00:00.000Z", "user-tokyo": "2026-10-31T01:00:00.000Z" };
    for (const [userId, at] of Object.entries(expected)) {
      const [run] = await runsOf(idOf(people[userId]!));
      expect(run).toMatchObject({ status: "scheduled", stepIndex: 0 });
      expect(run!.nextAt!.toISOString()).toBe(at);
      // the step job wakes it then
      const rows = await deps.db.execute<{ start_after: Date }>(sql`select start_after from pgboss.job where name = ${AUTOMATION_STEP_QUEUE} and data->>'runId' = ${run!.id}`);
      expect(new Date(rows.rows[0]!.start_after).toISOString()).toBe(at);
      // and at 10:00 the offer goes out
      await executeRun(deps, run!.id, new Date(at));
      expect((await sync(people[userId]!))[0]).toMatchObject({ kind: "paywall", text: "Come back for 50% off" });
    }
  });

  it("puts tomorrow at 10:00 at the right instant across DST changes and in zones with half hours", () => {
    const wait = { type: "local_time", days: 1, time: "10:00" } as const;
    // Los Angeles falls back on 1 Nov 2026: 10:00 PST is 18:00 UTC, the day before it was 17:00
    expect(waitUntil(wait, "America/Los_Angeles", new Date("2026-10-31T12:00:00Z")).toISOString()).toBe("2026-11-01T18:00:00.000Z");
    expect(waitUntil(wait, "Asia/Kolkata", new Date("2026-10-29T12:00:00Z")).toISOString()).toBe("2026-10-30T04:30:00.000Z");
    // a time the clocks skip (Berlin springs forward at 02:00) comes out as the clocks show it, an hour later
    expect(waitUntil({ type: "local_time", days: 1, time: "02:30" }, "Europe/Berlin", new Date("2027-03-27T12:00:00Z")).toISOString()).toBe("2027-03-28T01:30:00.000Z");
    // no time zone from the device: UTC
    expect(waitUntil(wait, null, new Date("2026-10-29T12:00:00Z")).toISOString()).toBe("2026-10-30T10:00:00.000Z");
  });
});

describe("editing", () => {
  it("validates definitions, and only admins edit", async () => {
    const team = await workspaceWithApp(app);
    const bad = (definition: unknown) => team.call(`/api/apps/${team.appId}/automations`, { method: "POST", body: JSON.stringify(definition) });
    expect((await bad({ name: "x", ...base, steps: [{ type: "wait", minutes: 5 }] })).status).toBe(400);
    expect((await bad({ name: "x", ...base, wait: { type: "delay", minutes: 5 }, steps: [{ type: "open_chat" }, { type: "message", text: "hi" }] })).status).toBe(400);
    expect((await bad({ name: "x", ...base, audience: { rules: Array(5).fill({ key: "a", op: "exists" }) } })).status).toBe(400);
    expect((await bad({ name: "x", ...base, senderUserId: "not-a-member" })).status).toBe(400);
    const member = await joinAsMember(app, deps, team.call);
    expect((await member.call(`/api/apps/${team.appId}/automations`, { method: "POST", body: JSON.stringify({ name: "x", ...base }) })).status).toBe(403);
    expect((await member.call(`/api/apps/${team.appId}/automations`)).status).toBe(200);
  });

  it("sends as the chosen teammate, quietly when push is off (offers always push)", async () => {
    const team = await workspaceWithApp(app);
    const { user } = (await (await team.call("/api/me")).json()) as any;
    await create(team, { senderUserId: user.id, withPush: false, steps: [{ type: "message", text: "Hi from Ada" }] });
    const device = await registerDevice(app, team.publicId);
    await track(device);
    const [message] = await sync(device);
    const conversationId = (await deps.db.select().from(conversations).where(and(eq(conversations.deviceId, idOf(device)))))[0]!.id;
    await reply(team.call, conversationId, "And a manual reply");
    const pushes = await deps.db.execute<{ n: number }>(sql`select count(*)::int as n from pgboss.job where name = 'push.send' and data->>'messageId' = ${message.id}`);
    expect(pushes.rows[0]!.n).toBe(0);
    const team2 = (await (await team.call(`/api/conversations/${conversationId}/messages`)).json()) as any;
    expect(team2.messages[0]).toMatchObject({ source: "automation", author: { name: "Ada Lovelace" } });
    const [row] = await deps.db.select().from(devices).where(eq(devices.id, idOf(device)));
    expect(row).toBeTruthy();
  });
});
