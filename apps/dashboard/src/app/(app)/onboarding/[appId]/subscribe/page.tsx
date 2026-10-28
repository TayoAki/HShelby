"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { SubscribeForm } from "@/components/billing";
import { OnboardingShell, StepTitle } from "@/components/Onboarding";
import { ChatWaitingPreview } from "@/components/Previews";
import { Spinner } from "@/components/ui";
import { useBilling } from "@/lib/billing";
import { useMe } from "@/lib/use-me";

export default function SubscribePage() {
  const { appId } = useParams<{ appId: string }>();
  const { billing } = useBilling();
  const me = useMe();

  return (
    <OnboardingShell current={3} appId={appId} previewLabel="In-app view · what your users see" preview={<ChatWaitingPreview received={false} />}>
      <StepTitle title="Subscribe" subtitle="One flat price for every app and teammate in your workspace." />
      {(!billing || !me) && <Spinner />}

      {billing && !billing.enabled && (
        <div className="mt-10 rounded-3xl bg-white p-6 text-left text-[15px] shadow-[0_0_0_1px_var(--line)]">
          <p>Billing isn&apos;t switched on in this environment yet.</p>
          <p className="mt-2 text-[14px] text-secondary">Your workspace and apps work without it. Subscriptions use Stripe in test mode once the keys are added.</p>
        </div>
      )}

      {billing?.enabled && billing.active && (
        <div className="mt-10 rounded-3xl bg-white p-6 text-[15px] shadow-[0_0_0_1px_var(--line)]">
          You&apos;re subscribed{billing.subscription?.cancelAtPeriodEnd ? " until the end of this period" : ""}.
        </div>
      )}

      {billing?.enabled && !billing.active && billing.offer && me?.organization && (
        <div className="mt-10">
          <SubscribeForm offer={billing.offer} organizationId={me.organization.id} canManage={billing.canManage} returnPath="/billing" />
        </div>
      )}

      <Link href="/apps" className="mt-8 inline-block text-[14px] text-secondary underline-offset-4 hover:text-fg hover:underline">
        Go to your apps →
      </Link>
    </OnboardingShell>
  );
}
