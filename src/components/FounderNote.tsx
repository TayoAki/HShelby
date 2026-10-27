"use client";

import Link from "next/link";
import { useRef, type ReactNode } from "react";
import { ChatCircleIcon, RocketLaunchIcon, SignOutIcon, StarIcon, TrendUpIcon, AppleLogoIcon } from "@phosphor-icons/react";
import { Avatar } from "@/components/art/Avatars";
import { useInView } from "@/lib/hooks";

type Tone = "orange" | "blue" | "green" | "pink";

function Chip({ tone, icon, children }: { tone: Tone; icon: ReactNode; children: ReactNode }) {
  return (
    <span
      className="mx-0.5 inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 align-middle text-[.82em] font-medium leading-[1.2] tracking-[-.025em] sm:gap-1.5 sm:px-2.5"
      style={{ background: `var(--context-glass-${tone})`, color: `var(--context-ink-${tone})` }}
    >
      {icon}
      {children}
    </span>
  );
}

const groups: { name: string; avatars: string[]; bubbles: ReactNode[] }[] = [
  {
    name: "Frederick",
    avatars: ["Frederick"],
    bubbles: [
      <>hey 👋 we&apos;re andi and frederick.</>,
      <>iOS apps are tough.</>,
      <>
        apple takes <Chip tone="orange" icon={<AppleLogoIcon weight="fill" />}>15-30%</Chip>, you can&apos;t request{" "}
        <Chip tone="blue" icon={<StarIcon weight="fill" />}>reviews</Chip> during onboarding, it&apos;s hard to{" "}
        <Chip tone="green" icon={<TrendUpIcon weight="bold" />}>upsell</Chip> users or get feedback.
      </>,
    ],
  },
  {
    name: "Andi",
    avatars: ["Andi"],
    bubbles: [
      <>
        your customers just <Chip tone="pink" icon={<SignOutIcon weight="bold" />}>churn</Chip>.
      </>,
      <>
        we built reception, a toolkit to solve all these issues, via{" "}
        <Chip tone="blue" icon={<ChatCircleIcon weight="bold" />}>in app support</Chip>, and soon{" "}
        <Chip tone="green" icon={<ChatCircleIcon weight="fill" />}>imessage</Chip>.
      </>,
    ],
  },
  {
    name: "Frederick",
    avatars: ["Frederick"],
    bubbles: [<>our early adopters saw significant reduction in churn, more upsells and more reviews.</>],
  },
  {
    name: "Frederick & Andi",
    avatars: ["Frederick", "Andi"],
    bubbles: [
      <>
        we&apos;re so <Chip tone="orange" icon={<RocketLaunchIcon weight="bold" />}>excited</Chip> to bring this to all of
        you. we&apos;re just getting started.
      </>,
    ],
  },
];

const bubble =
  "w-fit max-w-full origin-bottom-left rounded-[22px] bg-[var(--landing-panel)] px-4 py-2.5 text-[16px] leading-[1.5] tracking-[-.015em] text-pretty last:rounded-bl-md sm:px-5 sm:py-3 sm:text-[19px]";

export function FounderNote() {
  const ref = useRef<HTMLDivElement>(null);
  const seen = useInView(ref, { amount: 0.25, once: true });
  let order = 0;
  const reveal = () => {
    const delay = order++ * 260;
    return seen
      ? { animation: `bubble-in .45s cubic-bezier(.22,1,.36,1) ${delay}ms both` }
      : { opacity: 0, transform: "translateY(12px) scale(.97)" };
  };

  return (
    <section
      aria-label="A note from the founders"
      className="mx-auto flex min-h-svh max-w-[680px] flex-col justify-center py-[calc(var(--landing-section-gap)/2)]"
    >
      <h2 className="mb-[var(--landing-heading-gap)] text-balance text-center text-[clamp(34px,4vw,60px)] leading-[1.12]">
        by appmaxxers
        <span className="block text-[var(--landing-secondary)]">for appmaxxers</span>
      </h2>
      <div ref={ref} className="space-y-6">
        {groups.map((g, gi) => (
          <div key={gi} className="flex items-end gap-3">
            {g.avatars.length === 1 ? (
              <Avatar name={g.avatars[0]} className="size-9 text-[14px] sm:size-10" />
            ) : (
              <div className="relative size-9 shrink-0 sm:size-10">
                <Avatar name={g.avatars[0]} className="absolute left-0 top-0 size-6 border-2 border-[var(--landing-background)] text-[10px] sm:size-7" />
                <Avatar name={g.avatars[1]} className="absolute bottom-0 right-0 size-6 border-2 border-[var(--landing-background)] text-[10px] sm:size-7" />
              </div>
            )}
            <div className="min-w-0 space-y-1.5">
              <p className="pl-4 text-[12px] text-[var(--landing-secondary)]">{g.name}</p>
              {g.bubbles.map((b, bi) => (
                <p key={bi} className={bubble} style={reveal()}>
                  {b}
                </p>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-6 flex origin-bottom-right flex-col items-end gap-1.5" style={reveal()}>
        <p className="pr-4 text-[12px] text-[var(--landing-secondary)]">you</p>
        <Link
          prefetch={false}
          href="/login"
          className="rounded-[22px] rounded-br-md bg-[var(--landing-foreground)] px-4 py-2.5 text-[16px] leading-[1.5] tracking-[-.015em] text-[var(--landing-background)] transition-opacity hover:opacity-85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--landing-foreground)] sm:px-5 sm:py-3 sm:text-[19px]"
        >
          i&apos;m in 🙌
        </Link>
      </div>
      <Signatures draw={seen} />
    </section>
  );
}

/** Two handwritten-style strokes; stands in for the founders' signature SVGs. */
function Signatures({ draw }: { draw: boolean }) {
  const path = (d: string, delay: number) => (
    <path
      d={d}
      pathLength={1}
      style={
        draw
          ? { strokeDasharray: "1 0", animation: `signature-draw 1.4s ease-in-out ${delay}ms both` }
          : { strokeDasharray: "0 1", opacity: 0 }
      }
    />
  );
  return (
    <div role="img" aria-label="Signed, Andi and Frederick" className="mx-auto mb-6 mt-8 flex w-fit items-end gap-5 text-[var(--landing-foreground)] sm:gap-7">
      <svg viewBox="0 0 200 110" width="107" className="h-auto max-w-[42vw] -skew-x-8" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {path("M20 84 C30 40 44 22 52 30 C58 38 46 70 40 86 M34 64 L62 60 M70 84 C72 70 78 62 86 64 C92 66 88 80 94 84 C102 74 108 62 118 64 C126 66 120 86 132 84 C150 80 170 76 190 74", 1600)}
      </svg>
      <svg viewBox="0 0 200 110" width="107" className="h-auto max-w-[42vw] -skew-x-8" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {path("M30 30 C40 28 60 26 74 28 M44 30 C40 50 36 70 34 90 M38 60 L62 58 M80 84 C84 70 90 64 98 66 C104 68 100 82 108 84 C118 82 122 66 132 66 C140 68 136 84 146 84 C162 82 176 78 192 76", 2600)}
      </svg>
    </div>
  );
}
