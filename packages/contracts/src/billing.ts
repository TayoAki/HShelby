import { z } from "zod";

/** An amount in the currency's minor unit (cents), as Stripe reports it. */
export const Price = z.object({ amount: z.number().int(), currency: z.string() });
export type Price = z.infer<typeof Price>;

/**
 * What a new subscriber pays now. While founder spots last, `plan` is "founder" and `founder` says how many
 * are claimed and what comes after; once they're gone (or with no later price set up) `founder` is null.
 */
export const BillingOffer = z.object({
  plan: z.string(),
  monthly: Price.nullable(),
  yearly: Price.nullable(),
  founder: z.object({ claimed: z.number().int(), total: z.number().int(), nextMonthly: Price.nullable() }).nullable(),
});
export type BillingOffer = z.infer<typeof BillingOffer>;

/** `GET /api/billing`. `active` is what gating uses: with billing switched off, everything is allowed. */
export const BillingState = z.object({
  enabled: z.boolean(),
  active: z.boolean(),
  subscription: z
    .object({
      plan: z.string(),
      status: z.string().nullable(),
      interval: z.enum(["month", "year"]).nullable(),
      periodEnd: z.string().nullable(),
      cancelAtPeriodEnd: z.boolean(),
    })
    .nullable(),
  offer: BillingOffer.nullable(),
  /** Owners and admins start and manage the subscription. */
  canManage: z.boolean(),
});
export type BillingState = z.infer<typeof BillingState>;

/** `GET /public/pricing`, for the landing page. */
export const PublicPricing = z.object({ enabled: z.boolean(), offer: BillingOffer.nullable() });
export type PublicPricing = z.infer<typeof PublicPricing>;
