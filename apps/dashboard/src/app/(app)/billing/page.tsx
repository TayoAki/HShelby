"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { SubscribeForm } from "@/components/billing";
import { secondaryButton, SettingsCard } from "@/components/settings";
import { ErrorNote, Spinner } from "@/components/ui";
import { openBillingPortal, useBilling } from "@/lib/billing";
import { useMe } from "@/lib/use-me";

const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { dateStyle: "medium" }) : "");
const planName = (plan: string) => `${plan.charAt(0).toUpperCase()}${plan.slice(1)} plan`;

/** Checkout sends people back here with `?subscribed=1`. */
function JustSubscribed() {
  return useSearchParams().get("subscribed") === "1" ? <p className="mb-3 text-[15px]">Thanks, you&apos;re subscribed.</p> : null;
}

export default function BillingPage() {
  const me = useMe();
  const { billing } = useBilling();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const organizationId = me?.organization?.id;

  async function manage() {
    if (!organizationId) return;
    setBusy(true);
    setError(null);
    // on success the browser leaves for Stripe's billing portal
    const message = await openBillingPortal(organizationId);
    if (message) {
      setBusy(false);
      setError(message);
    }
  }

  const sub = billing?.subscription;
  const manageButton = billing?.canManage && sub && (
    <button type="button" onClick={manage} disabled={busy} className={secondaryButton}>
      {busy ? "Opening…" : "Manage billing"}
    </button>
  );

  return (
    <div className="mx-auto max-w-4xl px-5 pb-16">
      <AppHeader className="h-20" />
      {!billing || !me ? (
        <Spinner />
      ) : (
        <main className="max-w-2xl pt-8">
          <p className="text-[14px] text-secondary">{me.organization?.name}</p>
          <h1 className="text-[40px] leading-[1.1] tracking-[-.045em]">Billing</h1>
          <p className="mt-2 text-[15px] text-secondary">One flat price for every app and teammate in your workspace.</p>

          <div className="mt-8 space-y-6">
            {error && <ErrorNote>{error}</ErrorNote>}

            {!billing.enabled && (
              <SettingsCard title="Not switched on">
                <p className="text-[15px]">Billing isn&apos;t switched on in this environment, so nothing is locked.</p>
              </SettingsCard>
            )}

            {billing.enabled && billing.active && sub && (
              <SettingsCard title={planName(sub.plan)}>
                <Suspense fallback={null}>
                  <JustSubscribed />
                </Suspense>
                <p className="text-[15px]">
                  {sub.status === "past_due"
                    ? "Your last payment didn't go through. Stripe is retrying; update your card so replies keep working."
                    : sub.cancelAtPeriodEnd
                      ? `Cancelled. Everything stays on until ${day(sub.periodEnd)}.`
                      : sub.status === "trialing"
                        ? `Trial until ${day(sub.periodEnd)}.`
                        : `Renews on ${day(sub.periodEnd)}.`}
                </p>
                {sub.interval && <p className="mt-1 text-[14px] text-secondary">Billed {sub.interval === "year" ? "yearly" : "monthly"}.</p>}
                {manageButton && <div className="mt-5">{manageButton}</div>}
                {!billing.canManage && <p className="mt-4 text-[14px] text-secondary">Owners and admins manage billing.</p>}
              </SettingsCard>
            )}

            {billing.enabled && !billing.active && (
              <>
                <SettingsCard title={sub ? "Your subscription has ended" : "Not subscribed yet"}>
                  <p className="text-[15px]">
                    Users can still write in, and nothing is lost. Subscribe to reply to them, add more apps and invite teammates.
                  </p>
                  <p className="mt-2 text-[14px] text-secondary">Before subscribing, you can reply in each app&apos;s setup conversation.</p>
                  {manageButton && <div className="mt-5">{manageButton}</div>}
                </SettingsCard>
                {billing.offer && organizationId && (
                  <SubscribeForm offer={billing.offer} organizationId={organizationId} canManage={billing.canManage} returnPath="/billing" />
                )}
              </>
            )}
          </div>
        </main>
      )}
    </div>
  );
}
