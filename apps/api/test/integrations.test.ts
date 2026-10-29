/* eslint-disable @typescript-eslint/no-explicit-any -- response bodies are asserted on, not typed */
import { randomUUID } from "node:crypto";
import { apps, devices } from "@hshelby/db";
import {
  adaptyEvent,
  appStoreNotification,
  revenueCatEvent,
  superwallEvent,
  TEST_ROOTS,
} from "@hshelby/subscriptions/testing";
import { signSvix } from "@hshelby/subscriptions";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { joinAsMember, makeTestApp, registerDevice, workspaceWithApp } from "./helpers";

const { app, deps, close } = await makeTestApp({ appStoreRoots: TEST_ROOTS });
afterAll(close);

type Team = Awaited<ReturnType<typeof workspaceWithApp>>;

const connect = async (team: Team, provider: string, body: unknown = {}) => {
  const res = await team.call(`/api/apps/${team.appId}/integrations/${provider}`, { method: "PUT", body: JSON.stringify(body) });
  expect(res.status).toBe(200);
  return ((await res.json()) as any).integrations.find((i: any) => i.provider === provider);
};
const deliver = (team: Team, provider: string, body: unknown, headers: Record<string, string> = {}) =>
  app.request(`/webhooks/${provider}/${team.publicId}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });
const log = async (team: Team) => ((await (await team.call(`/api/apps/${team.appId}/provider-events`)).json()) as any).events as any[];
const subscriptionOf = async (deviceId: string) => (await deps.db.select().from(devices).where(eq(devices.id, deviceId)))[0]!.subscription;

/** A registered device and its ID (the access token's subject). */
async function person(team: Team, extra: Record<string, unknown> = {}) {
  const device = await registerDevice(app, team.publicId, extra);
  const id = JSON.parse(Buffer.from(device.session.accessToken.split(".")[1], "base64url").toString()).sub as string;
  return { device, id };
}

describe("RevenueCat", () => {
  it("authenticates, normalizes, matches every device of the person, and ignores redeliveries", async () => {
    const team = await workspaceWithApp(app);
    const { authorization, webhookUrl } = await connect(team, "revenuecat");
    expect(authorization).toMatch(/^Bearer /);
    expect(webhookUrl).toBe(`https://api.test/webhooks/revenuecat/${team.publicId}`);

    const phone = await person(team, { identity: { userId: "user-42" } });
    const ipad = await person(team, { identity: { userId: "user-42" } });
    const stranger = await person(team, { identity: { userId: "someone-else" } });

    const trial = revenueCatEvent("INITIAL_PURCHASE", { period_type: "TRIAL" });
    expect((await deliver(team, "revenuecat", trial, { authorization: "Bearer wrong" })).status).toBe(401);
    const ok = await deliver(team, "revenuecat", trial, { authorization });
    expect(ok.status).toBe(200);
    // RevenueCat retries until it gets a 2xx; the same event is recorded once
    expect(((await (await deliver(team, "revenuecat", trial, { authorization })).json()) as any).duplicate).toBe(true);

    expect(await subscriptionOf(phone.id)).toMatchObject({ status: "trial", paying: true, provider: "revenuecat", productId: "pro.yearly" });
    expect(await subscriptionOf(ipad.id)).toMatchObject({ status: "trial" });
    expect(await subscriptionOf(stranger.id)).toBeNull();

    const events = await log(team);
    expect(events.map((e) => [e.status, e.event ?? e.reason])).toEqual([
      ["accepted", "trial_started"],
      ["refused", "wrong Authorization header"],
    ]);
    expect(events[0]).toMatchObject({ provider: "revenuecat", rawType: "INITIAL_PURCHASE", person: "user-42", devicesReached: 2, environment: "production" });
  });

  it("matches by the revenuecat_id custom field, and logs tests, ignored and unmatched events", async () => {
    const team = await workspaceWithApp(app);
    const { authorization } = await connect(team, "revenuecat");
    const anon = await person(team, { metadata: { revenuecat_id: "$RCAnonymousID:8a6f" } });
    await deliver(team, "revenuecat", revenueCatEvent("RENEWAL", { app_user_id: "$RCAnonymousID:8a6f", aliases: [] }), { authorization });
    expect(await subscriptionOf(anon.id)).toMatchObject({ status: "active" });

    await deliver(team, "revenuecat", revenueCatEvent("TEST"), { authorization });
    await deliver(team, "revenuecat", revenueCatEvent("UNCANCELLATION"), { authorization });
    await deliver(team, "revenuecat", revenueCatEvent("RENEWAL", { app_user_id: "nobody", original_app_user_id: "nobody", aliases: [] }), { authorization });
    expect((await log(team)).map((e) => e.status)).toEqual(["unmatched", "ignored", "test", "accepted"]);
  });
});

describe("Superwall", () => {
  it("needs its signing secret and checks the signature", async () => {
    const team = await workspaceWithApp(app);
    expect((await team.call(`/api/apps/${team.appId}/integrations/superwall`, { method: "PUT", body: "{}" })).status).toBe(400);
    const secret = `whsec_${Buffer.from(randomUUID()).toString("base64")}`;
    expect(await connect(team, "superwall", { signingSecret: secret })).toMatchObject({ connected: true, hasSigningSecret: true, authorization: null });
    const device = await person(team, { identity: { userId: "user-42" } });

    const body = JSON.stringify(superwallEvent("cancellation", { cancelReason: "UNSUBSCRIBE", price: 0 }));
    expect((await deliver(team, "superwall", body, signSvix(body, `whsec_${Buffer.from("other").toString("base64")}`))).status).toBe(401);
    expect((await deliver(team, "superwall", body, signSvix(body, secret))).status).toBe(200);
    expect(await subscriptionOf(device.id)).toMatchObject({ status: "cancelled", paying: true, provider: "superwall" });
  });
});

describe("Adapty", () => {
  it("answers the URL check, then matches by user ID or the adapty_id custom field", async () => {
    const team = await workspaceWithApp(app);
    const { authorization } = await connect(team, "adapty");
    const check = await deliver(team, "adapty", {});
    expect(check.status).toBe(200);
    expect(await check.json()).toEqual({});

    const byProfile = await person(team, { metadata: { adapty_id: "4f7c1d3e-9a2b-4c8d-b1e6-0a9f8e7d6c5b" } });
    await deliver(team, "adapty", adaptyEvent("subscription_refunded", { customer_user_id: null }), { authorization });
    expect(await subscriptionOf(byProfile.id)).toMatchObject({ status: "refunded", paying: false });
    expect((await deliver(team, "adapty", adaptyEvent("trial_started"))).status).toBe(401);
  });
});

describe("App Store Server Notifications", () => {
  it("verifies Apple's signature, matches StoreKit transaction IDs and appAccountToken, and checks the bundle ID", async () => {
    const team = await workspaceWithApp(app);
    expect(await connect(team, "appstore")).toMatchObject({ connected: true, authorization: null });
    await deps.db.update(apps).set({ bundleId: "com.example.lockdlist" }).where(eq(apps.id, team.appId));

    const byTransaction = await person(team);
    await byTransaction.device.sdk("/v1/device", { method: "PATCH", json: { storekit: { paying: true, originalTransactionIds: ["2000000800000001"] } } });
    await deliver(team, "appstore", appStoreNotification("DID_FAIL_TO_RENEW", "GRACE_PERIOD"));
    expect(await subscriptionOf(byTransaction.id)).toMatchObject({ status: "billing_issue", provider: "appstore" });
    const [row] = await deps.db.select().from(devices).where(eq(devices.id, byTransaction.id));
    expect(row).toMatchObject({ reportedPaying: true, originalTransactionIds: ["2000000800000001"] });

    const token = randomUUID();
    const byToken = await person(team, { identity: { userId: token.toUpperCase() } });
    await deliver(team, "appstore", appStoreNotification("SUBSCRIBED", "INITIAL_BUY", { trial: true, originalTransactionId: "999", appAccountToken: token }));
    expect(await subscriptionOf(byToken.id)).toMatchObject({ status: "trial" });

    const other = await deliver(team, "appstore", appStoreNotification("DID_RENEW", undefined, { bundleId: "com.example.other" }));
    expect(other.status).toBe(400);
    // a signature from outside Apple's chain: the real root doesn't trust the test one
    const strict = await makeTestApp();
    const res = await strict.app.request(`/webhooks/appstore/${team.publicId}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(appStoreNotification("DID_RENEW", undefined)),
    });
    expect(res.status).toBe(401);
    await strict.close();
    expect((await log(team)).map((e) => [e.status, e.reason])).toEqual([
      ["refused", "chain doesn't end at a trusted root"],
      ["refused", "wrong bundle ID (com.example.other)"],
      ["accepted", null],
      ["accepted", null],
    ]);
  });

  it("keeps the StoreKit transaction IDs a device reported across reports", async () => {
    const team = await workspaceWithApp(app);
    const { device, id } = await person(team, { storekit: { originalTransactionIds: ["1", "2"] } });
    await device.sdk("/v1/device", { method: "PATCH", json: { storekit: { originalTransactionIds: ["2", "3"] } } });
    const [row] = await deps.db.select().from(devices).where(eq(devices.id, id));
    expect(row!.originalTransactionIds).toEqual(["1", "2", "3"]);
  });
});

describe("settings", () => {
  it("refuses events for providers that aren't connected, and only admins connect or see secrets", async () => {
    const team = await workspaceWithApp(app);
    expect((await deliver(team, "revenuecat", revenueCatEvent("RENEWAL"))).status).toBe(404);
    expect((await log(team))[0]).toMatchObject({ status: "refused", reason: "not connected" });
    await connect(team, "revenuecat");
    const member = await joinAsMember(app, deps, team.call);
    expect((await member.call(`/api/apps/${team.appId}/integrations/adapty`, { method: "PUT", body: "{}" })).status).toBe(403);
    const seen = ((await (await member.call(`/api/apps/${team.appId}/integrations`)).json()) as any).integrations;
    expect(seen.find((i: any) => i.provider === "revenuecat")).toMatchObject({ connected: true, authorization: null });
    expect((await team.call(`/api/apps/${team.appId}/integrations/revenuecat`, { method: "DELETE" })).status).toBe(204);
    expect((await deliver(team, "revenuecat", revenueCatEvent("RENEWAL"))).status).toBe(404);
  });
});
