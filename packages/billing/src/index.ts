import { subscriptions, type Db } from "@hshelby/db";
import { and, countDistinct, eq, inArray } from "drizzle-orm";
import type Stripe from "stripe";

/*
 * One subscription per organization, through Stripe. Better Auth's Stripe plugin writes the rows; these are
 * the rules the API gates on and the worker's sync job applies, kept in one place.
 */

export type SubscriptionRow = typeof subscriptions.$inferSelect;

/** The first organizations to subscribe (up to the founder-spot limit) get the founder price, later ones the standard price. */
export const PLANS = { founder: "founder", standard: "standard" } as const;
export type PlanName = (typeof PLANS)[keyof typeof PLANS];

/**
 * Statuses that keep the team's paid features on. `past_due` is Stripe retrying a failed renewal: the team
 * keeps replying while it does, and the dashboard asks for a new card.
 */
export const ENTITLED_STATUSES = ["active", "trialing", "past_due"];
export const isEntitled = (status: string | null | undefined) => ENTITLED_STATUSES.includes(status ?? "");

/** Statuses Stripe never moves a subscription out of. */
export const FINAL_STATUSES = ["canceled", "incomplete_expired"];

/** The subscription to show and gate on: an entitled one if there is one, else the most recent. */
export function currentSubscription(rows: SubscriptionRow[]): SubscriptionRow | null {
  const latestFirst = [...rows].sort((a, b) => (b.periodEnd?.getTime() ?? 0) - (a.periodEnd?.getTime() ?? 0));
  return latestFirst.find((s) => isEntitled(s.status)) ?? latestFirst[0] ?? null;
}

export async function organizationSubscription(db: Db, organizationId: string) {
  return currentSubscription(await db.select().from(subscriptions).where(eq(subscriptions.referenceId, organizationId)));
}

/** Organizations holding a founder subscription that is still entitled (a cancelled one frees its spot). */
export async function founderSpotsClaimed(db: Db) {
  const [row] = await db
    .select({ n: countDistinct(subscriptions.referenceId) })
    .from(subscriptions)
    .where(and(eq(subscriptions.plan, PLANS.founder), inArray(subscriptions.status, ENTITLED_STATUSES)));
  return row?.n ?? 0;
}

const date = (seconds: number | null | undefined) => (seconds ? new Date(seconds * 1000) : null);

/** The columns a Stripe subscription sets on its row, as the Better Auth plugin writes them. */
export function subscriptionFields(sub: Stripe.Subscription) {
  const item = sub.items.data[0];
  return {
    status: sub.status,
    ...(item && { periodStart: date(item.current_period_start), periodEnd: date(item.current_period_end) }),
    cancelAtPeriodEnd: sub.cancel_at_period_end,
    cancelAt: date(sub.cancel_at),
    canceledAt: date(sub.canceled_at),
    endedAt: date(sub.ended_at),
    ...(sub.trial_start && sub.trial_end && { trialStart: date(sub.trial_start), trialEnd: date(sub.trial_end) }),
  };
}
