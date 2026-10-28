import type Stripe from "stripe";
import { afterAll, describe, expect, it } from "vitest";
import { currentSubscription, isEntitled, subscriptionFields, type SubscriptionRow } from "../src/index";
import { startFakeStripe } from "../src/testing";

const secret = "whsec_test";
const received: Stripe.Event[] = [];
const fake = await startFakeStripe({
  prices: { price_month: { amount: 2500, interval: "month" }, price_year: { amount: 20000, interval: "year" } },
  webhookSecret: secret,
  deliver: async (payload, signature) => {
    received.push(await fake.client().webhooks.constructEventAsync(payload, signature, secret));
  },
});
afterAll(() => fake.close());

const row = (patch: Partial<SubscriptionRow>): SubscriptionRow =>
  ({ id: "s", plan: "founder", referenceId: "org", status: "incomplete", periodEnd: null, ...patch }) as SubscriptionRow;

describe("status rules", () => {
  it("keeps paid features on while active, trialing or retrying a payment", () => {
    expect(["active", "trialing", "past_due"].map(isEntitled)).toEqual([true, true, true]);
    expect(["canceled", "unpaid", "incomplete", "incomplete_expired", "paused", null].map(isEntitled)).toEqual([false, false, false, false, false, false]);
  });

  it("picks the entitled subscription, else the latest", () => {
    const old = row({ id: "old", status: "canceled", periodEnd: new Date("2026-01-01") });
    const live = row({ id: "live", status: "active", periodEnd: new Date("2025-06-01") });
    const abandoned = row({ id: "abandoned" });
    expect(currentSubscription([old, live, abandoned])?.id).toBe("live");
    expect(currentSubscription([abandoned, old])?.id).toBe("old");
    expect(currentSubscription([])).toBeNull();
  });
});

describe("fake Stripe", () => {
  it("runs a checkout through the real SDK, with webhooks signed like Stripe's", async () => {
    const stripe = fake.client();
    const customer = await stripe.customers.create({ name: "Org", metadata: { organizationId: "org_1", customerType: "organization" } });
    const found = await stripe.customers.search({ query: 'metadata["organizationId"]:"org_1" AND metadata["customerType"]:"organization"' });
    expect(found.data.map((c) => c.id)).toEqual([customer.id]);

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customer.id,
      line_items: [{ price: "price_year", quantity: 1 }],
      success_url: "http://app/done?id={CHECKOUT_SESSION_ID}",
      subscription_data: { metadata: { subscriptionId: "row_1" } },
    });
    expect(session.url).toContain("/checkout/");

    const sub = await fake.completeCheckout(session.id);
    expect(received.map((e) => e.type)).toEqual(["customer.subscription.created", "checkout.session.completed"]);
    const retrieved = await stripe.subscriptions.retrieve(sub.id);
    expect(retrieved.metadata).toEqual({ subscriptionId: "row_1" });

    const fields = subscriptionFields(retrieved);
    expect(fields.status).toBe("active");
    expect((fields.periodEnd!.getTime() - fields.periodStart!.getTime()) / 86_400_000).toBe(365);

    await stripe.subscriptions.update(sub.id, { cancel_at_period_end: true });
    expect(received.at(-1)).toMatchObject({ type: "customer.subscription.updated", data: { previous_attributes: { cancel_at_period_end: false } } });
    await fake.end(sub.id);
    expect(subscriptionFields(await stripe.subscriptions.retrieve(sub.id))).toMatchObject({ status: "canceled", cancelAtPeriodEnd: true });

    const portal = await stripe.billingPortal.sessions.create({ customer: customer.id, return_url: "http://app/billing" });
    expect(portal.url).toContain("/portal/");
    await expect(stripe.subscriptions.retrieve("sub_missing")).rejects.toMatchObject({ statusCode: 404 });
  });
});
