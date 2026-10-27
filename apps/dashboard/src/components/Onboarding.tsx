"use client";

import { CheckIcon } from "@radix-ui/react-icons";
import Link from "next/link";
import type { ReactNode } from "react";
import { SignOutButton } from "./AuthGate";
import { BrandMark, Panel } from "./ui";

const steps = [
  { label: "Add app", slug: null },
  { label: "Connect", slug: "connect" },
  { label: "Integrations", slug: "integrations" },
  { label: "Subscribe", slug: "subscribe" },
] as const;

export function Stepper({ current, appId }: { current: number; appId?: string }) {
  return (
    <ol className="flex flex-wrap items-center justify-center gap-x-8 gap-y-2 text-[15px] sm:gap-x-12 sm:text-[17px]">
      {steps.map((step, i) => {
        const done = i < current;
        const content = (
          <span className={`inline-flex items-center gap-3 ${i === current ? "text-fg" : "text-secondary"}`}>
            {done ? (
              <CheckIcon aria-hidden="true" className="size-4" />
            ) : (
              <span aria-hidden="true" className={`size-2 rounded-full ${i === current ? "bg-[var(--accent)]" : "bg-[#d9d9de]"}`} />
            )}
            {step.label}
          </span>
        );
        const href = done && appId && step.slug ? `/onboarding/${appId}/${step.slug}` : null;
        return (
          <li key={step.label} aria-current={i === current ? "step" : undefined}>
            {href ? (
              <Link href={href} className="hover:text-fg">
                {content}
              </Link>
            ) : (
              content
            )}
          </li>
        );
      })}
    </ol>
  );
}

/** Two-panel onboarding layout: a phone preview on the left, the step's form on the right. */
export function OnboardingShell({
  current,
  appId,
  previewLabel,
  preview,
  children,
}: {
  current: number;
  appId?: string;
  previewLabel: string;
  preview: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-svh flex-col px-4 pb-6 sm:px-8 lg:px-14">
      <header className="relative flex h-20 items-center justify-between">
        <Link href="/apps" className="text-[20px]" aria-label="Your apps">
          <BrandMark />
        </Link>
        <div className="absolute left-1/2 hidden -translate-x-1/2 md:block">
          <Stepper current={current} appId={appId} />
        </div>
        <SignOutButton />
      </header>
      <div className="mb-6 md:hidden">
        <Stepper current={current} appId={appId} />
      </div>
      <main className="grid flex-1 gap-6 lg:grid-cols-[1.45fr_1fr]">
        <Panel className="hidden flex-col items-center px-8 pb-10 pt-12 lg:flex">
          <p className="text-[17px] text-secondary">{previewLabel}</p>
          <div className="flex w-full flex-1 items-center justify-center pt-8">{preview}</div>
        </Panel>
        <Panel className="flex items-center justify-center px-6 py-14 sm:px-12">
          <div className="w-full max-w-[460px] text-center">{children}</div>
        </Panel>
      </main>
    </div>
  );
}

export function StepTitle({ title, subtitle }: { title: string; subtitle: ReactNode }) {
  return (
    <>
      <h1 className="text-balance text-[40px] leading-[1.08] tracking-[-.045em] sm:text-[48px]">{title}</h1>
      <p className="mx-auto mt-4 max-w-[400px] text-balance text-[17px] leading-[1.55] text-secondary">{subtitle}</p>
    </>
  );
}
