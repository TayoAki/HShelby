import { FINAL_STATUSES, subscriptionFields } from "@hshelby/billing";
import { subscriptions, type Db } from "@hshelby/db";
import { and, eq, isNotNull, notInArray } from "drizzle-orm";
import type { Logger } from "pino";
import type Stripe from "stripe";

type Fields = Partial<typeof subscriptions.$inferSelect>;

const same = (a: unknown, b: unknown) => (a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : a === b);

/**
 * Backstop for Stripe's webhooks: re-reads every subscription Stripe may still change and fixes rows that
 * drifted, from a webhook Stripe gave up on or one that was acknowledged but failed to apply. Gating reads
 * these rows, so a missed "ended" or "renewed" would otherwise stick.
 */
export async function syncSubscriptions(db: Db, stripe: Stripe, logger: Logger) {
  const rows = await db
    .select()
    .from(subscriptions)
    .where(and(isNotNull(subscriptions.stripeSubscriptionId), notInArray(subscriptions.status, FINAL_STATUSES)));
  let fixed = 0;
  for (const row of rows) {
    let fields: Fields;
    try {
      fields = subscriptionFields(await stripe.subscriptions.retrieve(row.stripeSubscriptionId!));
    } catch (err) {
      if ((err as { statusCode?: number }).statusCode !== 404) {
        logger.warn({ err, subscriptionId: row.id }, "couldn't read a subscription from Stripe");
        continue;
      }
      // gone from Stripe (deleted test data): it can't be paying
      fields = { status: "canceled", endedAt: row.endedAt ?? new Date() };
    }
    const changed = Object.entries(fields).filter(([key, value]) => !same(row[key as keyof Fields], value));
    if (changed.length === 0) continue;
    await db.update(subscriptions).set(fields).where(eq(subscriptions.id, row.id));
    fixed++;
    logger.warn({ subscriptionId: row.id, organizationId: row.referenceId, fields: changed.map(([key]) => key) }, "subscription synced from Stripe");
  }
  return { checked: rows.length, fixed };
}
