/* eslint-disable @typescript-eslint/no-explicit-any -- response bodies are asserted on, not typed */
import { randomUUID } from "node:crypto";
import { founderSpotsClaimed } from "@hshelby/billing";
import { startFakeStripe } from "@hshelby/billing/testing";
import { subscriptions } from "@hshelby/db";
import { inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { joinAsMember, makeTestApp, ORIGIN, registerDevice, reply, signUp, workspaceWithApp, type TeamCall } from "./helpers";

const WEBHOOK_SECRET = "whsec_test_billing";
let dropWebhooks = false;
const fake = await startFakeStripe({
  prices: {
    price_founder_month: { amount: 2500, interval: "month" },
    price_founder_year: { amount: 20000, interval: "year" },
    price_standard_month: { amount: 5000, interval: "month" },
    price_standard_year: { amount: 40000, interval: "year" },
  },
  webhookSecret: WEBHOOK_SECRET,
  deliver: async (payload, signature) => {
    if (dropWebhooks) return;
    const res = await app.request("/api/auth/stripe/webhook", {
      method: "POST",
      headers: { "content-type": "application/json", "stripe-signature": signature },
      body: payload,
    });
    if (res.status !== 200) throw new Error(`webhook answered ${res.status}: ${await res.text()}`);
  },
});
const { app, deps, close } = await makeTestApp(
  { stripe: fake.client() },
  {
    STRIPE_SECRET_KEY: "sk_test_fake",
    STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
    STRIPE_PRICE_MONTHLY: "price_founder_month",
    STRIPE_PRICE_YEARLY: "price_founder_year",
    STRIPE_PRICE_STANDARD_MONTHLY: "price_standard_month",
    STRIPE_PRICE_STANDARD_YEARLY: "price_standard_year",
    FOUNDER_SPOTS: "3",
  },
);
afterAll(async () => {
  await close();
  await fake.close();
});

const billing = async (call: TeamCall) => (await (await call("/api/billing")).json()) as any;
const orgId = async (call: TeamCall) => ((await (await call("/api/me")).json()) as any).organization.id as string;

/** Starts Checkout the way the dashboard does; returns the response and the Checkout session ID. */
async function checkout(call: TeamCall, body: Record<string, unknown> = {}) {
  const res = await call("/api/auth/subscription/upgrade", {
    method: "POST",
    body: JSON.stringify({
      plan: (await billing(call)).offer.plan,
      referenceId: await orgId(call),
      customerType: "organization",
      successUrl: `${ORIGIN}/apps?subscribed=1`,
      cancelUrl: `${ORIGIN}/billing`,
      disableRedirect: true,
      ...body,
    }),
  });
  const json = (await res.json()) as any;
  return { res, json, sessionId: res.status === 200 ? (json.url as string).split("/").at(-1)! : "" };
}

async function subscribe(call: TeamCall, body: Record<string, unknown> = {}) {
  const { res, sessionId } = await checkout(call, body);
  expect(res.status).toBe(200);
  return fake.completeCheckout(sessionId);
}

/** A workspace whose app has its setup conversation, plus a second user's conversation. */
async function workspaceWithUsers() {
  const team = await workspaceWithApp(app);
  const developer = await registerDevice(app, team.publicId);
  const setup = ((await (await developer.send("Hello from setup")).json()) as any).conversation.id as string;
  const user = await registerDevice(app, team.publicId);
  const other = ((await (await user.send("My lists stopped syncing")).json()) as any).conversation.id as string;
  return { ...team, user, setup, other };
}

const invite = (call: TeamCall, organizationId: string) =>
  call("/api/auth/organization/invite-member", {
    method: "POST",
    body: JSON.stringify({ email: `teammate-${randomUUID()}@example.com`, role: "member", organizationId }),
  });

describe("without a subscription", () => {
  it("shows the founder offer and what's left of the spots", async () => {
    const team = await signUp(app);
    expect(await billing(team.call)).toEqual({
      enabled: true,
      active: false,
      subscription: null,
      offer: {
        plan: "founder",
        monthly: { amount: 2500, currency: "usd" },
        yearly: { amount: 20000, currency: "usd" },
        founder: { claimed: 0, total: 3, nextMonthly: { amount: 5000, currency: "usd" } },
      },
      canManage: true,
    });
    const pricing = await app.request("/public/pricing");
    expect(pricing.headers.get("access-control-allow-origin")).toBe("*");
    expect(((await pricing.json()) as any).offer.founder).toEqual({ claimed: 0, total: 3, nextMonthly: { amount: 5000, currency: "usd" } });
  });

  it("lets the team reply only in the setup conversation, while users keep writing in", async () => {
    const { call, user, setup, other } = await workspaceWithUsers();
    const list = ((await (await call("/api/conversations")).json()) as any).conversations;
    expect(Object.fromEntries(list.map((c: any) => [c.id, c.setup]))).toEqual({ [setup]: true, [other]: false });

    expect((await reply(call, setup, "Got it, setup works")).status).toBe(201);
    const refused = await reply(call, other, "Pull down to refresh");
    expect(refused.status).toBe(402);
    expect(((await refused.json()) as any).error.code).toBe("subscription_inactive");
    expect((await user.send("Hello? Anyone there?")).status).toBe(201);
  });

  it("keeps the first app free, but not a second app or teammates", async () => {
    const team = await workspaceWithApp(app);
    const second = await team.call("/api/apps", { method: "POST", body: JSON.stringify({ name: "Second app" }) });
    expect(second.status).toBe(402);
    const invited = await invite(team.call, await orgId(team.call));
    expect(invited.status).toBe(402);
  });
});

describe("founder spots", () => {
  it("move new subscribers to the standard price once taken, and free up when a founder leaves", async () => {
    // fill the remaining spots with other workspaces' founder subscriptions
    const open = 3 - (await founderSpotsClaimed(deps.db));
    expect(open).toBeGreaterThan(0);
    const fillers = Array.from({ length: open }, () => ({ id: randomUUID(), plan: "founder", referenceId: randomUUID(), status: "active" }));
    await deps.db.insert(subscriptions).values(fillers);
    try {
      const team = await workspaceWithApp(app);
      expect((await billing(team.call)).offer).toEqual({
        plan: "standard",
        monthly: { amount: 5000, currency: "usd" },
        yearly: { amount: 40000, currency: "usd" },
        founder: null,
      });
      expect((await checkout(team.call, { plan: "founder" })).json.code).toBe("plan_unavailable");
      await subscribe(team.call);
      expect((await billing(team.call)).subscription.plan).toBe("standard");

      await deps.db.delete(subscriptions).where(inArray(subscriptions.id, [fillers[0]!.id]));
      expect((await billing(team.call)).offer).toMatchObject({ plan: "founder", founder: { claimed: 2, total: 3 } });
    } finally {
      await deps.db.delete(subscriptions).where(inArray(subscriptions.id, fillers.map((f) => f.id)));
    }
  });
});

describe("subscribing", () => {
  it("turns replies on; a lapsed subscription turns them off again without losing anything", async () => {
    const { call, user, other } = await workspaceWithUsers();
    await subscribe(call);
    const state = await billing(call);
    expect(state).toMatchObject({ active: true, subscription: { plan: "founder", status: "active", interval: "month", cancelAtPeriodEnd: false } });
    expect(new Date(state.subscription.periodEnd).getTime()).toBeGreaterThan(Date.now() + 27 * 86_400_000);

    expect((await reply(call, other, "Pull down to refresh")).status).toBe(201);
    expect((await call("/api/apps", { method: "POST", body: JSON.stringify({ name: "Second app" }) })).status).toBe(201);
    expect((await invite(call, await orgId(call))).status).toBe(200);
  });

  it("follows the subscription through cancellation, failed payments and its end", async () => {
    const { call, user, other } = await workspaceWithUsers();
    const sub = await subscribe(call, { annual: true });
    expect((await billing(call)).subscription.interval).toBe("year");

    await fake.cancelAtPeriodEnd(sub.id);
    expect(await billing(call)).toMatchObject({ active: true, subscription: { cancelAtPeriodEnd: true } });
    await fake.resume(sub.id);
    await fake.failPayment(sub.id);
    // Stripe is retrying the payment: the team keeps working while the dashboard asks for a new card
    expect(await billing(call)).toMatchObject({ active: true, subscription: { status: "past_due" } });
    expect((await reply(call, other, "Still here")).status).toBe(201);

    await fake.end(sub.id);
    expect(await billing(call)).toMatchObject({ active: false, subscription: { status: "canceled" } });
    expect((await reply(call, other, "One more thing")).status).toBe(402);
    expect((await user.send("Did you get my message?")).status).toBe(201);
    const thread = ((await (await call(`/api/conversations/${other}/messages`)).json()) as any).messages;
    expect(thread.map((m: any) => m.text)).toEqual(["My lists stopped syncing", "Still here", "Did you get my message?"]);

    // subscribing again restores replies
    await subscribe(call);
    expect((await reply(call, other, "Back now")).status).toBe(201);
  });

  it("records the subscription on the way back from Checkout, even before the webhook", async () => {
    const team = await workspaceWithApp(app);
    const { sessionId } = await checkout(team.call);
    dropWebhooks = true;
    try {
      await fake.completeCheckout(sessionId);
    } finally {
      dropWebhooks = false;
    }
    expect((await billing(team.call)).active).toBe(false);
    const back = await team.call(`/api/auth/subscription/success?callbackURL=${encodeURIComponent("/apps")}&checkoutSessionId=${sessionId}`);
    expect(back.status).toBe(302);
    expect((await billing(team.call)).active).toBe(true);
  });

  it("sells only the plan on offer, only to admins of a workspace that isn't subscribed", async () => {
    const team = await workspaceWithApp(app);
    const member = await joinAsMember(app, deps, team.call);
    expect((await checkout(member.call)).res.status).not.toBe(200);
    const notOffered = (await billing(team.call)).offer.plan === "founder" ? "standard" : "founder";
    expect((await checkout(team.call, { plan: notOffered })).json.code).toBe("plan_unavailable");
    expect((await checkout(team.call, { customerType: "user" })).res.status).toBe(400);

    await subscribe(team.call);
    expect((await checkout(team.call)).json.code).toBe("already_subscribed");
    expect((await billing(member.call)).canManage).toBe(false);
  });

  it("refuses webhooks without Stripe's signature", async () => {
    const res = await app.request("/api/auth/stripe/webhook", {
      method: "POST",
      headers: { "content-type": "application/json", "stripe-signature": "t=1,v1=forged" },
      body: JSON.stringify({ id: "evt_forged", type: "customer.subscription.deleted", data: { object: {} } }),
    });
    expect(res.status).toBe(400);
  });
});

describe("with billing switched off", () => {
  it("gates nothing", async () => {
    const plain = await makeTestApp();
    try {
      const team = await workspaceWithApp(plain.app);
      expect(await (await team.call("/api/billing")).json()).toEqual({ enabled: false, active: true, subscription: null, offer: null, canManage: true });
      expect((await team.call("/api/apps", { method: "POST", body: JSON.stringify({ name: "Second app" }) })).status).toBe(201);
      expect(await (await plain.app.request("/public/pricing")).json()).toEqual({ enabled: false, offer: null });
    } finally {
      await plain.close();
    }
  });
});
