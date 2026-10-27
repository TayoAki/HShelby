"use client";

import { useEffect, useState, type ReactNode } from "react";
import { CheckCircledIcon, CheckIcon, Cross2Icon, StarFilledIcon, StarIcon } from "@radix-ui/react-icons";
import { CrownIcon, PuzzlePieceIcon, UserCircleIcon } from "@phosphor-icons/react";
import { useTimeline } from "@/lib/hooks";
import { PhoneFrame } from "@hshelby/ui";
import { Bubble, CardAction, ChatScreen, StatusBar, SystemLine, TeamBubble, Timestamp } from "@hshelby/ui";
import { AppIcon, appByName } from "@/components/art/Avatars";
import { BanknotesArt, ChromeStarsArt, ScooterArt } from "@/components/art/HeroProps";
import { Laptop } from "@/components/art/Devices";
import { InboxPreview } from "@/components/preview/InboxPreview";

type SceneProps = { playing: boolean; reduced: boolean };

const propClass = "absolute left-1/2 top-1/2 h-auto max-w-none -translate-x-1/2 -translate-y-1/2";

/** The big phone used by the conversion/reviews scenes. Its bottom is cut off by the stage
    mask; `pan` slides it up so the bottom of a sheet is visible. */
function StagePhone({ pan = false, children }: { pan?: boolean; children: ReactNode }) {
  return (
    <div aria-hidden="true" className="absolute inset-0 overflow-hidden [container-type:size]">
      <div className="absolute left-1/2 top-[var(--top)] w-[var(--w)] -translate-x-1/2 [--top:32px] [--w:60cqw] [filter:drop-shadow(var(--phone-frame-shadow))] sm:[--top:40px] sm:[--w:min(540px,80cqw)]">
        <div
          className="transition-transform duration-1000 ease-[cubic-bezier(.32,.72,0,1)] motion-reduce:transition-none"
          style={{ transform: pan ? "translateY(min(0px, calc(100cqh - 100% - 96px)))" : "none" }}
        >
          <PhoneFrame>{children}</PhoneFrame>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* conversion: "is there a cheaper way to keep this?" → offer → paywall */
/* ------------------------------------------------------------------ */

const conversionSteps = [1000, 2300, 3400, 3900, 5000, 6300, 7100, 7900, 8600];

const paywallPhotos = [
  { name: "coffee", bg: "linear-gradient(150deg,#c89f7a,#6b4a33)" },
  { name: "cabin", bg: "linear-gradient(150deg,#9fbf8f,#3f6142)" },
  { name: "city", bg: "linear-gradient(150deg,#9bb8e0,#3e5f8c)" },
  { name: "meadow", bg: "linear-gradient(150deg,#e8e19a,#7fa35b)" },
];

function Paywall({ phase }: { phase: number }) {
  const plans = [
    { name: "Yearly", was: "$83.88", price: "$49.99", period: "year", selected: true },
    { name: "Monthly", price: "$6.99", period: "month", selected: false },
  ];
  return (
    <div className="absolute inset-0 z-20 flex flex-col bg-white px-[6cqw] pb-[7cqw] pt-[24cqw] text-[#242424] [--preview-line:#eaeaed] [--preview-muted:#929296]">
      <div className="relative flex flex-col items-center">
        <div className="flex -space-x-[4cqw]">
          {paywallPhotos.map((p) => (
            <span key={p.name} className="size-[19cqw] rounded-full border-[.7cqw] border-white" style={{ background: p.bg }} />
          ))}
        </div>
        <span className="relative -mt-[3cqw] rounded-full border border-white bg-[var(--paywall-badge)] px-[4cqw] py-[1.5cqw] text-[3.6cqw] font-semibold shadow-[var(--paywall-badge-shadow)] backdrop-blur-xl">
          Stronger together
        </span>
      </div>
      <p className="mt-[7cqw] text-center text-[12cqw] leading-[.98] tracking-[-.055em] [font-family:var(--paywall-serif)]">
        Become your
        <br />
        best self.
      </p>
      <div className="my-auto py-[6cqw] text-center text-[4cqw] font-medium leading-[1.45] text-[var(--preview-muted)]">
        <p>Build habits that last.</p>
        <p>See how far you’ve come.</p>
        <p>Make time for you.</p>
      </div>
      <div className="space-y-[4cqw]">
        {plans.map((plan) => (
          <div
            key={plan.name}
            className={`relative flex items-center gap-[4cqw] rounded-[2.5cqw] border p-[4cqw] ${
              plan.selected ? "border-[#242424] shadow-[inset_0_0_0_1px_#242424]" : "border-[var(--preview-line)]"
            }`}
          >
            {plan.selected && (
              <span className="absolute -top-[3cqw] left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full border border-white bg-[var(--paywall-badge)] px-[4cqw] py-[1cqw] text-[2.9cqw] font-semibold shadow-[var(--paywall-badge-shadow)] backdrop-blur-xl">
                40% off · just for you
              </span>
            )}
            <span
              className={`grid size-[5cqw] shrink-0 place-items-center rounded-full border ${
                plan.selected ? "border-[#242424]" : "border-[var(--preview-muted)]"
              }`}
            >
              {plan.selected && <span className="size-[3cqw] rounded-full bg-[#242424]" />}
            </span>
            <span className="text-[4cqw] font-semibold">{plan.name}</span>
            <span className="ml-auto whitespace-nowrap text-[3.7cqw] font-semibold">
              {plan.was && <s className="mr-[1.5cqw] font-normal text-[var(--preview-muted)]">{plan.was}</s>}
              {plan.price}
              <span className="text-[3cqw]">/{plan.period}</span>
            </span>
          </div>
        ))}
      </div>
      <div
        className={`mx-[9cqw] mt-[8cqw] flex items-center justify-center gap-[2cqw] rounded-[2.5cqw] bg-[#242424] py-[4cqw] text-[4cqw] font-semibold text-white transition-transform duration-200 ${
          phase === 3 ? "scale-[.96]" : ""
        }`}
      >
        {phase >= 6 ? (
          <>
            <CheckIcon width="4cqw" height="4cqw" /> You’re on Yearly
          </>
        ) : (
          "Continue"
        )}
      </div>
      {phase >= 3 && <PurchaseSheet phase={phase} />}
    </div>
  );
}

/** Apple's purchase confirmation sheet. */
function PurchaseSheet({ phase }: { phase: number }) {
  return (
    <div className="absolute inset-0 z-30 animate-[bubble-in_.3s_ease-out_both] bg-[var(--purchase-overlay)]">
      <div className="absolute inset-x-[2cqw] bottom-[2cqw] rounded-[9cqw] bg-[var(--purchase-sheet)] px-[6cqw] pb-[5cqw] pt-[5cqw] text-[#1c1c1e] backdrop-blur-xl">
        <div className="flex items-center justify-between">
          <span className="text-[4.6cqw] font-semibold">App Store</span>
          <span className="grid size-[7cqw] place-items-center rounded-full bg-[#7878801f] text-[#8e8e93]">
            <Cross2Icon width="3.6cqw" height="3.6cqw" />
          </span>
        </div>
        <div className="mt-[4cqw] flex items-center gap-[3cqw] border-b border-[#3c3c4329] pb-[4cqw]">
          <AppIcon app={appByName("75 Days: Her Challenge")} className="size-[13cqw]" />
          <div className="text-[3.4cqw] leading-[1.3]">
            <p className="font-semibold">75 Days: Her Challenge</p>
            <p className="text-[#8e8e93]">Yearly Pro</p>
            <p className="text-[#8e8e93]">Subscription</p>
          </div>
        </div>
        <p className="mt-[4cqw] text-[4cqw] font-semibold">$49.99 / year</p>
        <p className="mt-[1cqw] text-[3cqw] text-[#8e8e93]">Renews yearly. Cancel anytime in Settings.</p>
        <div className="mt-[5cqw] flex h-[22cqw] flex-col items-center justify-center text-[var(--preview-blue)]">
          {phase === 3 && (
            <span className="flex items-center gap-[2cqw]">
              <svg viewBox="0 0 24 32" className="h-[7cqw] w-[5cqw]" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
                <rect x="4" y="2" width="15" height="28" rx="4" />
                <path d="M21 9v7M9 5h5M9 27h5M12 12l-3 4 3 4m-3-4h9" />
              </svg>
              <span className="text-[3.6cqw] text-[#1c1c1e]">Confirm with Side Button</span>
            </span>
          )}
          {phase === 4 && (
            <svg viewBox="0 0 40 40" className="size-[14cqw] animate-[faceid-pulse_.8s_ease-in-out_2]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M5 14V9a4 4 0 0 1 4-4h5m12 0h5a4 4 0 0 1 4 4v5M5 26v5a4 4 0 0 0 4 4h5m12 0h5a4 4 0 0 0 4-4v-5" />
              <path d="M13 15v3m14-3v3m-7-3v9h-3m-4 4c4 3 10 3 14 0" />
            </svg>
          )}
          {phase >= 5 && (
            <span className="flex flex-col items-center gap-[1.5cqw] text-[3.6cqw] text-[#1c1c1e]">
              <CheckCircledIcon width="12cqw" height="12cqw" className="text-[var(--preview-blue)]" />
              Done
            </span>
          )}
        </div>
      </div>
      {phase === 3 && (
        <span className="absolute -right-[1cqw] top-[24cqw] rounded-l-full bg-white/90 px-[2.5cqw] py-[1.2cqw] text-[2.8cqw] font-semibold text-[#1c1c1e]">
          Double Click
        </span>
      )}
    </div>
  );
}

export function ConversionScene({ playing, reduced }: SceneProps) {
  const d = useTimeline(conversionSteps, 11000, playing, reduced);
  const sheetOpen = d >= 4 && d < 8;
  const phase = d <= 4 ? 2 : Math.min(d - 2, 5);

  return (
    <>
      <div aria-hidden="true" className="absolute inset-0">
        <BanknotesArt className={`${propClass} w-[96%]`} />
      </div>
      <StagePhone pan={sheetOpen}>
        <ChatScreen
          overlay={
            <div
              className={`absolute inset-0 z-30 transition-transform duration-700 ease-[cubic-bezier(.32,.72,0,1)] ${
                sheetOpen ? "translate-y-0" : "translate-y-full"
              }`}
            >
              <Paywall phase={phase} />
              <StatusBar className="z-40 text-black" />
            </div>
          }
        >
          {d >= 1 && (
            <div className="flex flex-col gap-[3cqw]">
              <Timestamp />
              <Bubble outgoing>is there a cheaper way to keep this?</Bubble>
            </div>
          )}
          {d >= 2 && (
            <TeamBubble>
              <p>yearly is 40% off rn, want it?</p>
              <CardAction
                icon={<CrownIcon size="4.2cqw" weight="fill" />}
                label="View offer"
                pressed={d === 3}
                used={d >= 8}
              />
            </TeamBubble>
          )}
          {d >= 9 && (
            <SystemLine>
              <CrownIcon size="3.6cqw" weight="fill" />
              User upgraded to Yearly
            </SystemLine>
          )}
        </ChatScreen>
      </StagePhone>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* reviews: fixed issue → review card → App Store "Write a Review"      */
/* ------------------------------------------------------------------ */

const reviewSteps = [1000, 2300, 3400, 3900, 5000, 5800, 6800, 7400, 8200];

function ReviewSheet({ stars, title, sending }: { stars: boolean; title: boolean; sending: boolean }) {
  return (
    <div className="absolute inset-0 z-20 flex flex-col bg-[#f2f2f7] px-[5cqw] pt-[15cqw] text-[#1c1c1e]">
      <span className="absolute left-[7cqw] top-[9.5cqw] z-50 text-[2.8cqw] font-semibold text-[var(--preview-blue)]">◀ 75 Days</span>
      <div className="flex items-center justify-between text-[3.8cqw]">
        <span className="text-[var(--preview-blue)]">Cancel</span>
        <span className="font-semibold">Write a Review</span>
        <span className={`font-semibold text-[var(--preview-blue)] transition-transform ${sending ? "scale-90 opacity-60" : ""} ${stars ? "" : "opacity-40"}`}>
          Send
        </span>
      </div>
      <div className="mt-[6cqw] flex flex-col items-center gap-[2cqw]">
        <div className="flex gap-[2.5cqw] text-[var(--preview-blue)]">
          {Array.from({ length: 5 }, (_, i) =>
            stars ? (
              <StarFilledIcon
                key={i}
                width="8cqw"
                height="8cqw"
                className="animate-[star-fill_.25s_ease-out_both]"
                style={{ animationDelay: `${i * 90}ms` }}
              />
            ) : (
              <StarIcon key={i} width="8cqw" height="8cqw" />
            ),
          )}
        </div>
        <span className="text-[3cqw] text-[#8e8e93]">Tap a Star to Rate</span>
      </div>
      <div className="mt-[5cqw] rounded-[3cqw] bg-white text-[3.8cqw]">
        <p className={`border-b border-[#3c3c4329] px-[4cqw] py-[3cqw] ${title ? "" : "text-[#3c3c434d]"}`}>
          {title ? "best support ever ngl" : "Title"}
        </p>
        <p className="h-[30cqw] px-[4cqw] py-[3cqw] text-[#3c3c434d]">Review (Optional)</p>
      </div>
    </div>
  );
}

export function ReviewsScene({ playing, reduced }: SceneProps) {
  const d = useTimeline(reviewSteps, 11000, playing, reduced);
  const sheetOpen = d >= 4 && d < 8;
  return (
    <>
      <div aria-hidden="true" className="absolute inset-0">
        <ChromeStarsArt className={`${propClass} w-[96%]`} />
      </div>
      <StagePhone>
        <ChatScreen
          overlay={
            <div
              className={`absolute inset-0 z-30 transition-transform duration-700 ease-[cubic-bezier(.32,.72,0,1)] ${
                sheetOpen ? "translate-y-0" : "translate-y-full"
              }`}
            >
              <ReviewSheet stars={d >= 5} title={d >= 6} sending={d === 7} />
              <StatusBar className="z-40 text-black" />
            </div>
          }
        >
          {d >= 1 && (
            <div className="flex flex-col gap-[3cqw]">
              <Timestamp />
              <Bubble outgoing>yooo you actually fixed it 😭</Bubble>
            </div>
          )}
          {d >= 2 && (
            <TeamBubble>
              <p>anytime 🫶 if you&apos;re feeling it, a review helps us a ton</p>
              <CardAction
                icon={<StarFilledIcon width="4.2cqw" height="4.2cqw" />}
                label="Write a Review"
                pressed={d === 3}
                used={d >= 8}
              />
            </TeamBubble>
          )}
          {d >= 9 && (
            <SystemLine>
              <StarFilledIcon width="3.6cqw" height="3.6cqw" />
              User left a 5-star review
            </SystemLine>
          )}
        </ChatScreen>
      </StagePhone>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* retention: laptop inbox + phone + hanging reaction bubbles           */
/* ------------------------------------------------------------------ */

const retentionSteps = [1500, 3400, 5800, 7400];

const hanging = [
  { text: "yooo it works now 🙌", reaction: "😍", name: "J", color: "var(--stat-blue)", x: 13, phoneX: 34, string: 6, tilt: -5 },
  { text: "you guys actually replied?? 😭", reaction: "💯", name: "M", color: "var(--stat-red)", x: 31, string: 22, tilt: 4, wide: true },
  { text: "restored my purchase, legends 🙏", reaction: "❤️", name: "S", color: "var(--stat-green)", x: 50, string: 3, tilt: -2, wide: true },
  { text: "best support ever ngl", reaction: "🔥", name: "A", color: "var(--stat-yellow)", x: 67, string: 15, tilt: 6, wide: true },
  { text: "fixed in 2 mins wtf", reaction: "💯", name: "L", color: "var(--stat-blue)", x: 86, phoneX: 68, string: 4, phoneString: 13, tilt: 5 },
  { text: "ok i'm never leaving 💗", reaction: "😍", name: "T", color: "var(--stat-red)", x: 88, string: 26, tilt: -4, wide: true },
];

function RetentionChat({ d }: { d: number }) {
  return (
    <ChatScreen>
      {d >= 1 && (
        <div className="flex flex-col gap-[3cqw]">
          <Timestamp />
          <Bubble outgoing>bro my whole streak is gone 🥀</Bubble>
        </div>
      )}
      {d >= 2 && <TeamBubble>oh no, lemme fix that rn</TeamBubble>}
      {d >= 3 && <Bubble outgoing>yooo it&apos;s back. absolute legend 😭</Bubble>}
      {d >= 4 && (
        <SystemLine>
          <CheckIcon width="3.6cqw" height="3.6cqw" />
          Issue resolved
        </SystemLine>
      )}
    </ChatScreen>
  );
}

function HangingBubbles({ reduced }: { reduced: boolean }) {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden [container-type:size]">
      {hanging.map((b, order) => (
        <div
          key={b.text}
          className={`absolute left-[var(--phone-x)] top-0 w-max -translate-x-1/2 flex-col items-center sm:left-[var(--x)] ${
            b.wide ? "hidden sm:flex" : "flex"
          } ${reduced ? "" : "animate-[hang-drop_1s_cubic-bezier(.34,1.3,.64,1)_both]"}`}
          style={
            {
              "--x": `${b.x}%`,
              "--phone-x": `${b.phoneX ?? b.x}%`,
              "--string": `${b.string}cqh`,
              "--phone-string": `${b.phoneString ?? b.string}cqh`,
              animationDelay: `${150 + 120 * order}ms`,
              zIndex: 30 - b.string,
            } as React.CSSProperties
          }
        >
          <div
            className={`flex origin-top flex-col items-center ${reduced ? "" : "animate-[hang-sway_ease-in-out_infinite_alternate]"}`}
            style={{ animationDuration: `${2.8 + 0.35 * order}s` }}
          >
            <span className="block h-[calc(var(--phone-string)+56px)] w-px bg-[linear-gradient(to_bottom,transparent,var(--hanging-string)_56px)] sm:h-[calc(var(--string)+56px)]" />
            <div className="relative mb-4 ml-6" style={{ rotate: `${b.tilt}deg` }}>
              <span className="block max-w-[150px] rounded-[16px] bg-[var(--hanging-bubble)] px-3 py-2 text-[11px] leading-snug text-[var(--landing-foreground)] shadow-[var(--hanging-shadow)] sm:max-w-[220px] sm:rounded-[18px] sm:px-3.5 sm:text-[14px]">
                {b.text}
              </span>
              <span
                className="absolute -left-6 bottom-0 flex size-5 items-center justify-center rounded-full text-[10px] font-semibold text-white sm:-left-7 sm:size-6 sm:text-[11px]"
                style={{ background: b.color }}
              >
                {b.name}
              </span>
              <span className="absolute -bottom-3.5 left-2 flex size-5 items-center justify-center rounded-full bg-[var(--hanging-bubble)] text-[10px] shadow-[var(--hanging-shadow)] sm:size-6 sm:text-[11px]">
                {b.reaction}
              </span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function RetentionScene({ playing, reduced }: SceneProps) {
  const d = useTimeline(retentionSteps, 11000, playing, reduced);
  return (
    <div aria-hidden="true" className="absolute inset-0 overflow-hidden [container-type:size]">
      <div className="absolute left-[calc(4%-.0705*var(--mac))] top-[100cqh] hidden w-[var(--mac)] -translate-y-[86.8%] [--mac:min(162.9cqh,107cqw)] sm:block">
        <Laptop>
          <div className="h-full [container-type:inline-size]">
            <InboxPreview />
          </div>
        </Laptop>
      </div>
      <div className="absolute right-[6%] top-[36%] hidden w-[28%] [filter:drop-shadow(var(--phone-frame-shadow))] sm:block lg:right-[7%] lg:top-[40%] lg:w-[20%]">
        <PhoneFrame>
          <RetentionChat d={d} />
        </PhoneFrame>
      </div>
      <div className="absolute left-1/2 top-[30%] w-[58%] -translate-x-1/2 [filter:drop-shadow(var(--phone-frame-shadow))] sm:hidden">
        <PhoneFrame>
          <RetentionChat d={d} />
        </PhoneFrame>
      </div>
      <HangingBubbles reduced={reduced} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* integrations: scooter drives past a story card                       */
/* ------------------------------------------------------------------ */

const providers = [
  { name: "RevenueCat", key: "revenuecat", mark: "R" },
  { name: "Superwall", key: "superwall", mark: "S" },
  { name: "Adapty", key: "adapty", mark: "A" },
];

function ProviderChip({ playing }: { playing: boolean }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => setI((n) => n + 1), 2200);
    return () => clearInterval(id);
  }, [playing]);
  const p = providers[i % providers.length];
  return (
    <span className="relative mx-0.5 inline-flex align-middle text-[.78em] font-medium leading-[1.2] tracking-[-.025em] sm:mx-1" aria-label={p.name}>
      <span
        key={p.key}
        data-provider={p.key}
        aria-hidden="true"
        className="inline-flex animate-[bubble-in_.3s_ease-out_both] items-center gap-1.5 whitespace-nowrap rounded-full bg-[var(--provider-glass)] px-2.5 py-1 text-[var(--provider-ink)] sm:px-3 sm:py-1.5"
      >
        <span className="grid size-[1.1em] place-items-center rounded-[30%] bg-[var(--provider-ink)] text-[.7em] font-semibold text-white">
          {p.mark}
        </span>
        {p.name}
      </span>
    </span>
  );
}

const chip =
  "mx-0.5 inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-1 align-middle text-[.78em] font-medium leading-[1.2] tracking-[-.025em] sm:mx-1 sm:gap-1.5 sm:px-3 sm:py-1.5";

export function IntegrationsScene({ playing, reduced }: SceneProps) {
  return (
    <>
      <div aria-hidden="true" className="absolute left-1/2 top-1/2 w-[165%] -translate-x-1/2 -translate-y-1/2 sm:w-[96%] lg:w-[76%]">
        <div className={reduced ? "" : "animate-[scooter-drive_5.1s_linear_infinite]"}>
          <ScooterArt className="h-auto w-full" />
        </div>
      </div>
      <div className="absolute inset-0 flex items-center justify-center px-4 sm:p-10">
        <div className="w-full max-w-[600px] rounded-[var(--landing-choice-radius)] bg-[var(--spotlight-card)] px-5 py-6 shadow-[var(--spotlight-card-shadow)] sm:max-w-[520px] sm:px-7 sm:py-5">
          <div className="space-y-3 text-[16px] leading-[1.55] tracking-[-.025em] sm:space-y-8 sm:text-[clamp(16px,1.6vw,20px)]">
            <p>
              see{" "}
              <span className={`${chip} bg-[var(--context-glass-blue)] text-[var(--context-ink-blue)]`}>
                <UserCircleIcon weight="bold" /> who&apos;s writing
              </span>
              , their{" "}
              <span className={`${chip} bg-[var(--context-glass-orange)] text-[var(--context-ink-orange)]`}>
                <CrownIcon weight="fill" /> plan
              </span>{" "}
              and what they paid.
            </p>
            <p>
              synced from <ProviderChip playing={playing} />, plus{" "}
              <span className={`${chip} bg-[var(--context-glass-green)] text-[var(--context-ink-green)]`}>
                <PuzzlePieceIcon weight="bold" /> your own data
              </span>
              .
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
