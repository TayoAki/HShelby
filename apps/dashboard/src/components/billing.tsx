"use client";

import type { BillingOffer, BillingState } from "@hshelby/contracts";
import Link from "next/link";
import { useState } from "react";
import { ErrorNote, PrimaryButton } from "@/components/ui";
import { formatPrice, startCheckout } from "@/lib/billing";

/** Monthly or yearly at the price on offer, the founder spots left, and the button to Stripe Checkout. */
export function SubscribeForm({ offer, organizationId, canManage, returnPath }: { offer: BillingOffer; organizationId: string; canManage: boolean; returnPath: string }) {
  const [yearly, setYearly] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const options = [
    { yearly: false, label: "Monthly", price: offer.monthly, per: "per month" },
    { yearly: true, label: "Yearly", price: offer.yearly, per: "per year" },
  ];

  async function subscribe() {
    setBusy(true);
    setError(null);
    // on success the browser leaves for Stripe Checkout
    const message = await startCheckout({ plan: offer.plan, organizationId, yearly, returnPath });
    if (message) {
      setBusy(false);
      setError(message);
    }
  }

  return (
    <div>
      <div role="radiogroup" aria-label="Billing interval" className="grid grid-cols-2 gap-3">
        {options.map((option) => (
          <button
            key={option.label}
            type="button"
            role="radio"
            aria-checked={yearly === option.yearly}
            onClick={() => setYearly(option.yearly)}
            className={`rounded-3xl bg-white p-5 text-left transition-shadow ${
              yearly === option.yearly ? "shadow-[inset_0_0_0_2px_var(--fg)]" : "shadow-[inset_0_0_0_1px_var(--line)]"
            }`}
          >
            <span className="block text-[14px] text-secondary">{option.label}</span>
            <span className="mt-1 block text-[32px] leading-none tracking-[-.04em]">{option.price ? formatPrice(option.price) : "—"}</span>
            <span className="mt-1 block text-[13px] text-secondary">{option.per}</span>
          </button>
        ))}
      </div>
      {offer.founder && (
        <p className="mt-4 text-[14px] text-secondary">
          Founder price: {offer.founder.claimed} of {offer.founder.total} spots claimed
          {offer.founder.nextMonthly && <> · next price {formatPrice(offer.founder.nextMonthly)}/month</>}
        </p>
      )}
      {error && (
        <div className="mt-6">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}
      <div className="mt-8">
        {canManage ? (
          <PrimaryButton glow disabled={busy} onClick={subscribe}>
            {busy ? "Opening checkout…" : "Subscribe"}
          </PrimaryButton>
        ) : (
          <p className="rounded-2xl bg-panel px-4 py-3 text-[14px] text-secondary">Ask an owner or admin of this workspace to subscribe.</p>
        )}
      </div>
      <p className="mt-4 text-[13px] text-secondary">Stripe test mode: use card 4242 4242 4242 4242, any future date and CVC.</p>
    </div>
  );
}

/** The inbox's note when the team can't reply: lapsed or never subscribed, or a payment Stripe is retrying. */
export function BillingBanner({ billing }: { billing: BillingState | null }) {
  if (!billing?.enabled) return null;
  const pastDue = billing.subscription?.status === "past_due";
  if (billing.active && !pastDue) return null;
  return (
    <p role="status" className="border-b border-line bg-[#fff8e6] px-5 py-2.5 text-[14px]">
      {pastDue
        ? "Your last payment didn't go through. Update your card to keep replying."
        : "Your workspace isn't subscribed. Users can still write in and nothing is lost; subscribe to reply."}{" "}
      <Link href="/billing" className="underline underline-offset-2">
        {pastDue ? "Update card" : "Subscribe"}
      </Link>
    </p>
  );
}
