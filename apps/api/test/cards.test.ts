/* eslint-disable @typescript-eslint/no-explicit-any -- response bodies are asserted on, not typed */
import { randomUUID } from "node:crypto";
import { devices, messages } from "@hshelby/db";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { joinAsMember, makeTestApp, registerDevice, workspaceWithApp } from "./helpers";

const { app, deps, close } = await makeTestApp();
afterAll(close);

const PRO = { id: "pro_yearly", title: "Pro yearly", source: "revenuecat", products: [{ id: "pro.yearly", price: "$39.99", period: "P1Y", trial: "P1W" }] };
const EXIT = { id: "exit-offer", title: "Exit offer 50%", source: "revenuecat" };

/** A workspace whose user has written in from a device that reported `paywalls`. */
async function conversationWith(paywalls: unknown[] = [PRO]) {
  const team = await workspaceWithApp(app);
  const device = await registerDevice(app, team.publicId, { paywalls, identity: { name: "Alex" } });
  const { conversation } = (await (await device.send("How much is Pro?")).json()) as any;
  const card = (body: Record<string, unknown>) =>
    team.call(`/api/conversations/${conversation.id}/cards`, { method: "POST", body: JSON.stringify({ clientId: randomUUID(), ...body }) });
  const sync = async () => (await (await device.sdk("/v1/conversation")).json()) as any;
  const thread = async () => (await (await team.call(`/api/conversations/${conversation.id}/messages`)).json()) as any;
  return { team, device, conversationId: conversation.id as string, card, sync, thread };
}

const setAppStoreId = (team: Awaited<ReturnType<typeof workspaceWithApp>>, appStoreId: string | null) =>
  team.call(`/api/apps/${team.appId}`, { method: "PATCH", body: JSON.stringify({ appStoreId }) });

describe("paywall reports", () => {
  it("stores the device's list as reported, replaced whole, and builds the app's registry", async () => {
    const { team, device } = await conversationWith([PRO]);
    expect((await device.sdk("/v1/device", { method: "PATCH", json: { paywalls: [PRO, EXIT] } })).status).toBe(200);
    expect((await device.sdk("/v1/device", { method: "PATCH", json: { paywalls: [EXIT] } })).status).toBe(200);
    // other updates leave the list alone
    expect((await device.sdk("/v1/device", { method: "PATCH", json: { metadata: { plan: "free" } } })).status).toBe(200);

    const { conversations } = (await (await team.call("/api/conversations")).json()) as any;
    expect(conversations[0].device.paywalls).toEqual([{ ...EXIT, presentable: true, products: [] }]);
    expect(conversations[0].device.paywallsReportedAt).not.toBeNull();

    const { paywalls } = (await (await team.call(`/api/apps/${team.appId}/paywalls`)).json()) as any;
    expect(paywalls.map((p: any) => p.id).sort()).toEqual(["exit-offer", "pro_yearly"]);
    expect(paywalls.find((p: any) => p.id === "pro_yearly")).toMatchObject({ title: "Pro yearly", products: PRO.products });
  });

  it("refuses malformed reports", async () => {
    const { device } = await conversationWith();
    const patch = (paywalls: unknown) => device.sdk("/v1/device", { method: "PATCH", json: { paywalls } });
    expect((await patch([{ id: "has space", title: "x" }])).status).toBe(400);
    expect((await patch([{ id: "a", title: "" }])).status).toBe(400);
    expect((await patch([PRO, PRO])).status).toBe(400);
    expect((await patch(Array.from({ length: 21 }, (_, i) => ({ id: `p${i}`, title: `P${i}` })))).status).toBe(400);
    const products = Array.from({ length: 10 }, (_, i) => ({ id: `prod${i}` }));
    expect((await patch(Array.from({ length: 5 }, (_, i) => ({ id: `p${i}`, title: `P${i}`, products })))).status).toBe(400);
  });
});

describe("offer cards", () => {
  it("refuses an offer for a paywall the device didn't report, or can't present", async () => {
    const { card, device } = await conversationWith([PRO, { ...EXIT, presentable: false }]);
    const unreported = await card({ kind: "paywall", paywallId: "lifetime" });
    expect(unreported.status).toBe(422);
    expect(((await unreported.json()) as any).error.code).toBe("paywall_unavailable");
    expect((await card({ kind: "paywall", paywallId: "exit-offer" })).status).toBe(422);

    // once the app stops reporting it, it's refused too
    expect((await card({ kind: "paywall", paywallId: "pro_yearly" })).status).toBe(201);
    await device.sdk("/v1/device", { method: "PATCH", json: { paywalls: [] } });
    expect((await card({ kind: "paywall", paywallId: "pro_yearly", confirmRepeat: true })).status).toBe(422);
  });

  it("sends an offer the SDK can open and the team sees with the title it was sent with", async () => {
    const { card, device, sync, thread } = await conversationWith();
    const res = await card({ kind: "paywall", paywallId: "pro_yearly", text: "Here's 50% off for a year", buttonLabel: "Claim offer" });
    expect(res.status).toBe(201);

    // the app renames the paywall later; the card keeps its title
    await device.sdk("/v1/device", { method: "PATCH", json: { paywalls: [{ ...PRO, title: "Pro annual" }] } });
    const { messages: sdkMessages } = await sync();
    expect(sdkMessages.at(-1)).toMatchObject({
      sender: "agent",
      kind: "paywall",
      text: "Here's 50% off for a year",
      card: { type: "paywall", paywallId: "pro_yearly", buttonLabel: "Claim offer" },
      actionClickedAt: null,
    });
    expect(sdkMessages.at(-1).card.paywallTitle).toBeUndefined();
    const { messages: teamMessages } = await thread();
    expect(teamMessages.at(-1).card).toEqual({ type: "paywall", paywallId: "pro_yearly", paywallTitle: "Pro yearly", buttonLabel: "Claim offer" });
  });

  it("returns the stored card for a resent clientId, even if the paywall is gone", async () => {
    const { card, device } = await conversationWith();
    const clientId = randomUUID();
    const first = await card({ kind: "paywall", paywallId: "pro_yearly", clientId });
    await device.sdk("/v1/device", { method: "PATCH", json: { paywalls: [] } });
    const again = await card({ kind: "paywall", paywallId: "pro_yearly", clientId });
    expect(again.status).toBe(200);
    expect(((await again.json()) as any).message.id).toBe(((await first.json()) as any).message.id);
  });
});

describe("review cards", () => {
  it("needs the app's App Store ID, which only admins set", async () => {
    const { team, card, sync, device } = await conversationWith();
    const refused = await card({ kind: "review" });
    expect(refused.status).toBe(422);
    expect(((await refused.json()) as any).error.code).toBe("app_store_id_required");

    const member = await joinAsMember(app, deps, team.call);
    expect((await member.call(`/api/apps/${team.appId}`, { method: "PATCH", body: JSON.stringify({ appStoreId: "6700000099" }) })).status).toBe(403);
    expect((await setAppStoreId(team, "6700000099")).status).toBe(200);

    const sent = await card({ kind: "review", text: "Would you rate {app}?", scenario: "after_helping" });
    expect(sent.status).toBe(201);
    const { messages: sdkMessages } = await sync();
    expect(sdkMessages.at(-1)).toMatchObject({
      kind: "review",
      text: "Would you rate Ada Lovelace's app?",
      card: { type: "review", url: "https://apps.apple.com/app/id6700000099?action=write-review", buttonLabel: null },
    });
    const [row] = await deps.db.select().from(devices).where(eq(devices.id, await deviceId(device)));
    expect(row!.reviewAskedAt).not.toBeNull();

    // the link follows the app's current App Store ID; without one, the SDK shows the text without a button
    await setAppStoreId(team, null);
    expect((await sync()).messages.at(-1).card.url).toBeNull();
  });

  it("asks before repeating a card that got no reply", async () => {
    const { team, card, device } = await conversationWith();
    await setAppStoreId(team, "6700000098");
    expect((await card({ kind: "review" })).status).toBe(201);

    const repeat = await card({ kind: "review" });
    expect(repeat.status).toBe(409);
    expect(((await repeat.json()) as any).error.code).toBe("card_repeat_unconfirmed");
    // an offer is a different kind of card
    expect((await card({ kind: "paywall", paywallId: "pro_yearly" })).status).toBe(201);
    expect((await card({ kind: "review", confirmRepeat: true })).status).toBe(201);

    // after the user replies, no confirmation is needed
    await device.send("Done, 5 stars!");
    expect((await card({ kind: "review" })).status).toBe(201);
    expect((await card({ kind: "paywall", paywallId: "pro_yearly" })).status).toBe(201);
  });
});

/** The device's ID, from its conversation. */
async function deviceId(device: Awaited<ReturnType<typeof registerDevice>>) {
  const { conversation } = (await (await device.sdk("/v1/conversation")).json()) as any;
  const [row] = await deps.db.select({ deviceId: messages.deviceId }).from(messages).where(eq(messages.conversationId, conversation.id)).limit(1);
  return row!.deviceId!;
}

describe("click receipts", () => {
  it("records the first tap once, whatever comes after", async () => {
    const { card, device, thread } = await conversationWith();
    const { message } = (await (await card({ kind: "paywall", paywallId: "pro_yearly" })).json()) as any;
    const click = (body?: unknown) =>
      device.sdk(`/v1/actions/${message.id}/click`, body === undefined ? { method: "POST" } : { json: body });

    // taps racing each other: exactly one is the first
    const taps = await Promise.all(Array.from({ length: 5 }, () => click()));
    const results = (await Promise.all(taps.map((r) => r.json()))) as any[];
    expect(taps.every((r) => r.status === 200)).toBe(true);
    expect(results.filter((r) => r.first)).toHaveLength(1);
    expect(new Set(results.map((r) => r.actionClickedAt)).size).toBe(1);

    const later = (await (await click({ clickedAt: new Date(Date.now() + 60_000).toISOString() })).json()) as any;
    expect(later).toEqual({ actionClickedAt: results[0].actionClickedAt, first: false });
    expect((await thread()).messages.at(-1).actionClickedAt).toBe(results[0].actionClickedAt);
  });

  it("keeps an offline receipt's tap time within the card's lifetime", async () => {
    const { card, device } = await conversationWith();
    const { message } = (await (await card({ kind: "paywall", paywallId: "pro_yearly" })).json()) as any;
    const res = await device.sdk(`/v1/actions/${message.id}/click`, { json: { clickedAt: "2020-01-01T00:00:00Z" } });
    const { actionClickedAt } = (await res.json()) as any;
    expect(Date.parse(actionClickedAt)).toBeGreaterThanOrEqual(Date.parse(message.createdAt));
  });

  it("only takes taps on the device's own cards", async () => {
    const mine = await conversationWith();
    const other = await conversationWith();
    const { message } = (await (await other.card({ kind: "paywall", paywallId: "pro_yearly" })).json()) as any;
    expect((await mine.device.sdk(`/v1/actions/${message.id}/click`, { method: "POST" })).status).toBe(404);
    expect((await mine.device.sdk(`/v1/actions/not-a-uuid/click`, { method: "POST" })).status).toBe(404);

    const { message: text } = (await (await mine.device.send("plain text")).json()) as any;
    const res = await mine.device.sdk(`/v1/actions/${text.id}/click`, { method: "POST" });
    expect(res.status).toBe(422);
    expect(((await res.json()) as any).error.code).toBe("not_a_card");
  });
});

describe("stats", () => {
  it("counts cards sent and first opens by sender and paywall", async () => {
    const { team, card, device } = await conversationWith([PRO, EXIT]);
    await setAppStoreId(team, "6700000097");
    const offer = (await (await card({ kind: "paywall", paywallId: "pro_yearly" })).json()) as any;
    await card({ kind: "paywall", paywallId: "exit-offer", confirmRepeat: true });
    await card({ kind: "review" });
    await device.sdk(`/v1/actions/${offer.message.id}/click`, { method: "POST" });
    await device.sdk(`/v1/actions/${offer.message.id}/click`, { method: "POST" });

    const stats = (await (await team.call(`/api/apps/${team.appId}/cards/stats?days=7`)).json()) as any;
    expect(stats.days).toBe(7);
    expect(stats.offer).toEqual({ sent: 2, opened: 1 });
    expect(stats.review).toEqual({ sent: 1, opened: 0 });
    expect(stats.bySender).toEqual([
      { source: "dashboard", author: { id: expect.any(String), name: "Ada Lovelace" }, review: { sent: 1, opened: 0 }, offer: { sent: 2, opened: 1 } },
    ]);
    expect(stats.byPaywall).toEqual(
      expect.arrayContaining([
        { paywallId: "pro_yearly", title: "Pro yearly", sent: 1, opened: 1 },
        { paywallId: "exit-offer", title: "Exit offer 50%", sent: 1, opened: 0 },
      ]),
    );
    expect((await team.call(`/api/apps/${team.appId}/cards/stats?days=8`)).status).toBe(400);
  });
});

describe("card settings", () => {
  it("starts from defaults, and admins change templates and labels", async () => {
    const team = await workspaceWithApp(app);
    const get = async () => (await (await team.call(`/api/apps/${team.appId}/cards/settings`)).json()) as any;
    expect((await get()).reviewTemplates.general).toContain("{app}");
    const res = await team.call(`/api/apps/${team.appId}/cards/settings`, {
      method: "PUT",
      body: JSON.stringify({ offerButtonLabels: ["Claim 50% off", "See plans"] }),
    });
    expect(res.status).toBe(200);
    expect(await get()).toMatchObject({ offerButtonLabels: ["Claim 50% off", "See plans"], reviewButtonLabels: [] });

    const member = await joinAsMember(app, deps, team.call);
    expect((await member.call(`/api/apps/${team.appId}/cards/settings`, { method: "PUT", body: "{}" })).status).toBe(403);
  });
});
