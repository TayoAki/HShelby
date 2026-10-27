"use client";

import type { BillingConfig, Me } from "@hshelby/contracts";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { OnboardingShell, StepTitle } from "@/components/Onboarding";
import { ChatWaitingPreview } from "@/components/Previews";
import { ErrorNote, PrimaryButton, Spinner } from "@/components/ui";
import { api } from "@/lib/api";
import { authClient } from "@/lib/auth-client";

const prices = { monthly: { label: "Monthly", price: "$25", per: "per month" }, yearly: { label: "Yearly", price: "$200", per: "per year" } };

export default function SubscribePage() {
  const { appId } = useParams<{ appId: string }>();
  const [billing, setBilling] = useState<BillingConfig | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [interval, setBillingInterval] = useState<"monthly" | "yearly">("monthly");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    Promise.all([api<BillingConfig>("/billing"), api<Me>("/me")])
      .then(([b, m]) => {
        setBilling(b);
        setMe(m);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Couldn't load billing"));
  }, []);

  async function subscribe() {
    if (!me?.organization || !billing) return;
    setBusy(true);
    setError(null);
    const origin = window.location.origin;
    const { error } = await authClient.subscription.upgrade({
      plan: billing.plan,
      annual: interval === "yearly",
      referenceId: me.organization.id,
      customerType: "organization",
      successUrl: `${origin}/apps?subscribed=1`,
      cancelUrl: `${origin}/onboarding/${appId}/subscribe`,
    });
    // On success the client redirects to Stripe Checkout.
    if (error) {
      setBusy(false);
      setError(error.message ?? "Couldn't start checkout");
    }
  }

  const active = billing?.subscription && ["active", "trialing"].includes(billing.subscription.status ?? "");

  return (
    <OnboardingShell current={3} appId={appId} previewLabel="In-app view · what your users see" preview={<ChatWaitingPreview received={false} />}>
      <StepTitle title="Subscribe" subtitle="One flat price for every app and teammate in your workspace." />
      {!billing && !error && <Spinner />}
      {error && (
        <div className="mt-8">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}

      {billing && !billing.enabled && (
        <div className="mt-10 rounded-3xl bg-white p-6 text-left text-[15px] shadow-[0_0_0_1px_var(--line)]">
          <p>Billing isn&apos;t switched on in this environment yet.</p>
          <p className="mt-2 text-[14px] text-secondary">Your workspace and apps work without it. Subscriptions use Stripe in test mode once the keys are added.</p>
        </div>
      )}

      {billing?.enabled && active && (
        <div className="mt-10 rounded-3xl bg-white p-6 text-[15px] shadow-[0_0_0_1px_var(--line)]">
          You&apos;re subscribed{billing.subscription?.cancelAtPeriodEnd ? " until the end of this period" : ""}.
        </div>
      )}

      {billing?.enabled && !active && (
        <>
          <div role="radiogroup" aria-label="Billing interval" className="mt-10 grid grid-cols-2 gap-3">
            {(Object.keys(prices) as (keyof typeof prices)[]).map((key) => (
              <button
                key={key}
                type="button"
                role="radio"
                aria-checked={interval === key}
                onClick={() => setBillingInterval(key)}
                className={`rounded-3xl bg-white p-5 text-left transition-shadow ${
                  interval === key ? "shadow-[inset_0_0_0_2px_var(--fg)]" : "shadow-[inset_0_0_0_1px_var(--line)]"
                }`}
              >
                <span className="block text-[14px] text-secondary">{prices[key].label}</span>
                <span className="mt-1 block text-[32px] leading-none tracking-[-.04em]">{prices[key].price}</span>
                <span className="mt-1 block text-[13px] text-secondary">{prices[key].per}</span>
              </button>
            ))}
          </div>
          <div className="mt-8">
            <PrimaryButton glow disabled={busy} onClick={subscribe}>
              {busy ? "Opening checkout…" : "Subscribe"}
            </PrimaryButton>
          </div>
          <p className="mt-4 text-[13px] text-secondary">Stripe test mode: use card 4242 4242 4242 4242, any future date and CVC.</p>
        </>
      )}

      <Link href="/apps" className="mt-8 inline-block text-[14px] text-secondary underline-offset-4 hover:text-fg hover:underline">
        Go to your apps →
      </Link>
    </OnboardingShell>
  );
}
