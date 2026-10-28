import type { BillingState, Price } from "@hshelby/contracts";
import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import { authClient } from "./auth-client";

// One request per page load, shared by the header banner and the page; returning from Stripe reloads the page.
let pending: Promise<BillingState> | null = null;

/** The workspace's subscription, what it may do without one, and what subscribing costs now. */
export function useBilling() {
  const [billing, setBilling] = useState<BillingState | null>(null);
  const load = useCallback((fresh: boolean) => {
    if (fresh) pending = null;
    (pending ??= api<BillingState>("/billing")).then(setBilling).catch(() => {
      pending = null;
    });
  }, []);
  useEffect(() => load(false), [load]);
  return { billing, reload: useCallback(() => load(true), [load]) };
}

/** "$25", or "$24.50" when there are cents. */
export function formatPrice(price: Price) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: price.currency.toUpperCase(),
    minimumFractionDigits: price.amount % 100 === 0 ? 0 : 2,
  }).format(price.amount / 100);
}

/** Sends the browser to Stripe Checkout for the plan on offer; resolves with an error message if it can't. */
export async function startCheckout(input: { plan: string; organizationId: string; yearly: boolean; returnPath: string }) {
  const origin = window.location.origin;
  const { error } = await authClient.subscription.upgrade({
    plan: input.plan,
    annual: input.yearly,
    referenceId: input.organizationId,
    customerType: "organization",
    successUrl: `${origin}${input.returnPath}${input.returnPath.includes("?") ? "&" : "?"}subscribed=1`,
    cancelUrl: `${origin}${input.returnPath}`,
  });
  return error ? (error.message ?? "Couldn't start checkout") : null;
}

/** Sends the browser to Stripe's billing portal (card, invoices, plan, cancellation). */
export async function openBillingPortal(organizationId: string) {
  const { error } = await authClient.subscription.billingPortal({
    referenceId: organizationId,
    customerType: "organization",
    returnUrl: `${window.location.origin}/billing`,
  });
  return error ? (error.message ?? "Couldn't open billing") : null;
}
