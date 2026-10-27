"use client";

import { useParams, useRouter } from "next/navigation";
import { OnboardingShell, StepTitle } from "@/components/Onboarding";
import { ChatWaitingPreview } from "@/components/Previews";
import { PrimaryButton } from "@/components/ui";

const upcoming = [
  { name: "Push notifications", detail: "Tell users when you reply (APNs key)" },
  { name: "Telegram", detail: "Get every message in Telegram and reply from there" },
  { name: "RevenueCat, Superwall, Adapty", detail: "See each user's plan next to the chat" },
  { name: "Review requests", detail: "Ask happy users for an App Store review" },
];

export default function IntegrationsPage() {
  const { appId } = useParams<{ appId: string }>();
  const router = useRouter();
  return (
    <OnboardingShell current={2} appId={appId} previewLabel="In-app view · what your users see" preview={<ChatWaitingPreview received={false} />}>
      <StepTitle title="Integrations" subtitle="Connect the tools you already use. These arrive in the next phases; you can skip them for now." />
      <ul className="mt-10 divide-y divide-[var(--line)] rounded-3xl bg-white text-left shadow-[0_0_0_1px_var(--line)]">
        {upcoming.map((item) => (
          <li key={item.name} className="flex items-center justify-between gap-4 px-5 py-4">
            <span>
              <span className="block text-[15px]">{item.name}</span>
              <span className="block text-[13px] text-secondary">{item.detail}</span>
            </span>
            <span className="shrink-0 rounded-full bg-panel px-3 py-1 text-[12px] text-secondary">Coming soon</span>
          </li>
        ))}
      </ul>
      <div className="mt-10">
        <PrimaryButton onClick={() => router.push(`/onboarding/${appId}/subscribe`)}>Continue</PrimaryButton>
      </div>
    </OnboardingShell>
  );
}
