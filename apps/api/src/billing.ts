import { founderSpotsClaimed, isEntitled, organizationSubscription, PLANS } from "@hshelby/billing";
import type { BillingOffer, BillingState, Price } from "@hshelby/contracts";
import { apps, conversations, type Db } from "@hshelby/db";
import { and, count, eq, isNull } from "drizzle-orm";
import type { Logger } from "pino";
import type Stripe from "stripe";
import type { Env } from "./env";
import { ApiError } from "./errors";
import { isAdminRole } from "./middleware";

/*
 * One flat subscription per organization. Without an active one, end users can still write in and nothing
 * is lost, but the team can't reply (except in each app's setup conversation), add a second app or invite
 * teammates. With billing switched off (no Stripe variables), nothing is gated.
 */

const PRICE_CACHE_MS = 10 * 60 * 1000;

export type Billing = ReturnType<typeof createBilling>;

export function createBilling({ db, env, stripe, logger }: { db: Db; env: Env; stripe: Stripe | null; logger: Logger }) {
  const founder = { monthly: env.STRIPE_PRICE_MONTHLY!, yearly: env.STRIPE_PRICE_YEARLY! };
  const standard =
    env.STRIPE_PRICE_STANDARD_MONTHLY && env.STRIPE_PRICE_STANDARD_YEARLY
      ? { monthly: env.STRIPE_PRICE_STANDARD_MONTHLY, yearly: env.STRIPE_PRICE_STANDARD_YEARLY }
      : null;

  const prices = new Map<string, { price: Price | null; at: number }>();
  /** A price's amount, from Stripe, cached for a while; null if Stripe can't say. */
  async function price(id: string): Promise<Price | null> {
    const cached = prices.get(id);
    if (cached && Date.now() - cached.at < PRICE_CACHE_MS) return cached.price;
    try {
      const p = await stripe!.prices.retrieve(id);
      const value = p.unit_amount === null ? null : { amount: p.unit_amount, currency: p.currency };
      prices.set(id, { price: value, at: Date.now() });
      return value;
    } catch (err) {
      logger.warn({ err, priceId: id }, "couldn't read a Stripe price");
      return null;
    }
  }

  async function isActive(organizationId: string) {
    if (!stripe) return true;
    return isEntitled((await organizationSubscription(db, organizationId))?.status);
  }

  /** What a new subscriber pays now: the founder price until the spots are taken, then the standard price. */
  async function offer(): Promise<BillingOffer | null> {
    if (!stripe) return null;
    const claimed = await founderSpotsClaimed(db);
    const founderOpen = !standard || claimed < env.FOUNDER_SPOTS;
    const ids = founderOpen ? founder : standard!;
    const [monthly, yearly, nextMonthly] = await Promise.all([
      price(ids.monthly),
      price(ids.yearly),
      founderOpen && standard ? price(standard.monthly) : null,
    ]);
    return {
      plan: founderOpen ? PLANS.founder : PLANS.standard,
      monthly,
      yearly,
      founder: founderOpen && standard ? { claimed, total: env.FOUNDER_SPOTS, nextMonthly } : null,
    };
  }

  const inactive = (message: string) => new ApiError(402, "subscription_inactive", message);

  return {
    enabled: Boolean(stripe),

    /** The plans Better Auth's Stripe plugin checks out and recognizes in webhooks. */
    plans: [
      { name: PLANS.founder, priceId: founder.monthly, annualDiscountPriceId: founder.yearly },
      ...(standard ? [{ name: PLANS.standard, priceId: standard.monthly, annualDiscountPriceId: standard.yearly }] : []),
    ],

    isActive,
    offer,

    async state(organizationId: string, role: string): Promise<BillingState> {
      const canManage = isAdminRole(role);
      if (!stripe) return { enabled: false, active: true, subscription: null, offer: null, canManage };
      const sub = await organizationSubscription(db, organizationId);
      // a row without a Stripe subscription is a checkout that was started and never finished
      const shown = sub?.stripeSubscriptionId ? sub : null;
      return {
        enabled: true,
        active: isEntitled(sub?.status),
        subscription: shown && {
          plan: shown.plan,
          status: shown.status,
          interval: shown.billingInterval === "year" || shown.billingInterval === "month" ? shown.billingInterval : null,
          periodEnd: shown.periodEnd?.toISOString() ?? null,
          cancelAtPeriodEnd: Boolean(shown.cancelAtPeriodEnd),
        },
        offer: await offer(),
        canManage,
      };
    },

    /** Replies need a subscription, except in the app's setup conversation (the developer's own test device). */
    async requireCanReply(organizationId: string, conversationId: string) {
      if (await isActive(organizationId)) return;
      const [row] = await db
        .select({ setupConversationId: apps.setupConversationId })
        .from(conversations)
        .innerJoin(apps, eq(apps.id, conversations.appId))
        .where(and(eq(conversations.id, conversationId), eq(conversations.organizationId, organizationId)))
        .limit(1);
      // an unknown conversation is the route's 404 to give
      if (!row || row.setupConversationId === conversationId) return;
      throw inactive("Subscribe to reply. Your users can still write in, and nothing is lost.");
    },

    /** The first app is free to set up; more need a subscription. */
    async requireCanAddApp(organizationId: string) {
      if (await isActive(organizationId)) return;
      const [row] = await db
        .select({ n: count() })
        .from(apps)
        .where(and(eq(apps.organizationId, organizationId), isNull(apps.deletedAt)));
      if (row!.n > 0) throw inactive("Subscribe to add more apps.");
    },
  };
}
