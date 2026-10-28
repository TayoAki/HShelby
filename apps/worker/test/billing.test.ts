import { randomUUID } from "node:crypto";
import { startFakeStripe } from "@hshelby/billing/testing";
import { createDb, subscriptions } from "@hshelby/db";
import { eq } from "drizzle-orm";
import pino from "pino";
import { afterAll, describe, expect, it } from "vitest";
import { syncSubscriptions } from "../src/jobs/billing";

const { db, pool } = createDb(process.env.TEST_DATABASE_URL ?? "postgres://postgres@localhost:5433/hshelby_test");
// no webhook target: every change the fake makes is a webhook that never arrived
const fake = await startFakeStripe({ prices: { price_month: { amount: 2500, interval: "month" } }, webhookSecret: "whsec_unused" });
const stripe = fake.client();
afterAll(async () => {
  await fake.close();
  await pool.end();
});

/** A paid Stripe subscription and the row the webhooks wrote for it at the time. */
async function paidSubscription() {
  const customer = await stripe.customers.create({ name: "Org" });
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customer.id,
    line_items: [{ price: "price_month", quantity: 1 }],
    success_url: "http://app/done",
  });
  const sub = await fake.completeCheckout(session.id);
  const item = sub.items.data[0];
  const id = randomUUID();
  await db.insert(subscriptions).values({
    id,
    plan: "founder",
    referenceId: randomUUID(),
    stripeCustomerId: customer.id,
    stripeSubscriptionId: sub.id,
    status: "active",
    periodStart: new Date(item.current_period_start * 1000),
    periodEnd: new Date(item.current_period_end * 1000),
    cancelAtPeriodEnd: false,
  });
  return { id, sub };
}

const rowOf = async (id: string) => (await db.select().from(subscriptions).where(eq(subscriptions.id, id)))[0]!;
const silent = pino({ level: "silent" });

describe("billing sync", () => {
  it("applies changes whose webhooks never arrived, and leaves settled rows alone", async () => {
    const ended = await paidSubscription();
    const renewed = await paidSubscription();
    const untouched = await paidSubscription();
    const gone = await paidSubscription();
    await db.update(subscriptions).set({ stripeSubscriptionId: "sub_deleted_in_stripe" }).where(eq(subscriptions.id, gone.id));
    const finished = randomUUID();
    await db.insert(subscriptions).values({ id: finished, plan: "founder", referenceId: randomUUID(), stripeSubscriptionId: "sub_old", status: "canceled" });

    const endedAt = Math.floor(Date.now() / 1000);
    await fake.quietly(ended.sub.id, { status: "canceled", ended_at: endedAt, canceled_at: endedAt });
    const item = renewed.sub.items.data[0];
    const nextEnd = item.current_period_end + 30 * 86_400;
    renewed.sub.items.data[0] = { ...item, current_period_start: item.current_period_end, current_period_end: nextEnd };

    const result = await syncSubscriptions(db, stripe, silent);
    expect(result.fixed).toBeGreaterThanOrEqual(3);
    expect(await rowOf(ended.id)).toMatchObject({ status: "canceled", endedAt: new Date(endedAt * 1000) });
    expect((await rowOf(renewed.id)).periodEnd).toEqual(new Date(nextEnd * 1000));
    expect((await rowOf(gone.id)).status).toBe("canceled");
    expect((await rowOf(untouched.id)).status).toBe("active");

    // a second run finds nothing left to fix among these
    const again = await syncSubscriptions(db, stripe, silent);
    expect(again.fixed).toBe(0);
  });
});
