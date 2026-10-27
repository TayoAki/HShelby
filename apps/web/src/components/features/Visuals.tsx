import { BellIcon, ChatBubbleIcon, ClockIcon, SunIcon } from "@radix-ui/react-icons";
import { CoffeeIcon, FileTextIcon, LightningIcon, OpenAiLogoIcon, UserCircleIcon } from "@phosphor-icons/react/dist/ssr";
import type { ReactNode } from "react";
import { PhoneFrame } from "@hshelby/ui";
import { AppIcon, appByName } from "@/components/art/Avatars";
import { HomeScreen } from "@/components/art/Devices";

/* ------------------------------ native chat ------------------------------ */

const alarms = [
  { time: "6:30", label: "Early Bird · Weekdays", on: true, icon: <SunIcon width="3cqw" height="3cqw" /> },
  { time: "7:30", label: "Morning Routine · Every day", on: true, icon: <ClockIcon width="3cqw" height="3cqw" /> },
  { time: "9:00", label: "Weekend Reset · Weekends", on: false, icon: <BellIcon width="3cqw" height="3cqw" /> },
];

/** "Clucky", a customer alarm app, with reception's chat sheet open on top in Clucky's colors. */
function CluckyApp() {
  return (
    <div className="absolute inset-0 origin-top overflow-hidden" style={{ borderRadius: "9cqw", transform: "translateY(3.5%) scale(0.92)" }}>
      <div className="absolute inset-0 flex flex-col bg-[var(--native-clucky-surface)] font-[system-ui] text-[var(--native-clucky-ink)]">
        <div className="flex h-[13cqw] shrink-0 items-center justify-between px-[8cqw] pt-[2cqw] text-[3.6cqw] font-semibold">
          <span>9:41</span>
        </div>
        <div className="flex items-center justify-between px-[5cqw] pt-[2cqw]">
          <span className="flex items-center gap-[2cqw] text-[7.5cqw] font-black tracking-[-.04em]">
            <AppIcon app={appByName("Clucky")} className="size-[7.5cqw]" />
            Clucky
          </span>
          <span className="flex items-center gap-[3cqw]">
            <span className="text-[4.4cqw] font-black text-[var(--native-clucky-orange)]">🔥3</span>
            <span className="flex size-[9cqw] items-center justify-center rounded-full bg-[var(--native-clucky-ember)] text-white">
              <ChatBubbleIcon width="4.6cqw" height="4.6cqw" />
            </span>
          </span>
        </div>
        <div className="mt-[4cqw] grid grid-cols-7 gap-y-[1.5cqw] px-[4cqw] text-center text-[3cqw] font-extrabold">
          {["Su", "Mo", "Tu", "W", "Th", "Fr", "Sa"].map((d) => (
            <span key={d}>{d}</span>
          ))}
          {Array.from({ length: 7 }, (_, i) => (
            <span
              key={i}
              className={`mx-auto flex size-[10cqw] items-center justify-center rounded-full text-[6cqw] ${i < 3 ? "" : "bg-[var(--native-clucky-off)]/60"}`}
            >
              {i < 3 ? "🔥" : ""}
            </span>
          ))}
        </div>
        <p className="mt-[5cqw] px-[5cqw] text-[4.6cqw] font-bold">Next Wakeup</p>
        <div className="mx-[4cqw] mt-[2cqw] flex items-end justify-between rounded-[6cqw] bg-white px-[5cqw] py-[4cqw]">
          <span className="text-[3.4cqw] font-bold text-[var(--native-clucky-alert)]">
            Tomorrow
            <span className="block font-medium text-[var(--native-muted)]">Alarm in 8 hours</span>
          </span>
          <span className="text-[11cqw] font-black leading-none tracking-[-.04em]">
            7:30<span className="text-[4cqw]">AM</span>
          </span>
        </div>
        <p className="mt-[5cqw] px-[5cqw] text-[4.6cqw] font-bold">Alarms</p>
        <div className="mt-[2cqw] flex flex-col gap-[2.5cqw] px-[4cqw]">
          {alarms.map((a) => (
            <div key={a.time} className={`rounded-[6cqw] bg-white px-[5cqw] py-[3.5cqw] ${a.on ? "" : "text-[var(--native-clucky-off)]"}`}>
              <div className="flex items-center justify-between">
                <span className="text-[8cqw] font-black leading-none tracking-[-.04em]">
                  {a.time}
                  <span className="text-[5.5cqw]"> am</span>
                </span>
                <span
                  className={`flex h-[6.4cqw] w-[11cqw] items-center rounded-full p-[.7cqw] ${
                    a.on ? "justify-end bg-[var(--native-clucky-ember)]" : "bg-[var(--native-clucky-off)]/50"
                  }`}
                >
                  <span className="size-[5cqw] rounded-full bg-white" />
                </span>
              </div>
              <p className="mt-[2cqw] flex items-center gap-[1.5cqw] text-[3cqw] font-semibold">
                {a.icon}
                {a.label}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function NativeChatVisual() {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center" aria-hidden="true">
      <div className="relative h-full w-full overflow-hidden">
        <div className="absolute inset-0 flex items-center justify-center pl-[14%]">
          <div className="h-[88%] [filter:drop-shadow(var(--phone-frame-shadow))]">
            <PhoneFrame className="h-full">
              <CluckyApp />
              <div className="absolute inset-0 z-10 bg-black opacity-[.28]" />
              <div className="absolute inset-x-0 bottom-0 top-[8.5%] z-20 overflow-hidden rounded-t-[9cqw] shadow-[0_-2cqw_6cqw_rgb(0_0_0/15%)]">
                <div
                  data-website-support=""
                  data-chat-fixed=""
                  className="absolute inset-0 flex flex-col bg-[var(--website-chat-background)] text-[var(--website-chat-foreground)] [--website-chat-background:var(--native-clucky-surface)] [--website-chat-incoming:#fff] [--website-chat-outgoing:var(--native-clucky-ember)] [font-family:var(--website-chat-font)]"
                >
                  <span className="website-glass relative mx-auto mt-[6cqw] shrink-0 rounded-full px-[4cqw] py-[2cqw] text-[4.2cqw] font-semibold leading-none">
                    Clucky support
                  </span>
                  <div className="flex min-h-0 flex-1 flex-col gap-[2cqw] px-[4cqw] pt-[8cqw] text-[4.2cqw] leading-[1.3]">
                    <p className="mb-[1cqw] text-center text-[2.8cqw] text-[var(--website-chat-secondary)]">Today 9:41</p>
                    <span className="max-w-[80%] self-end rounded-[4.2cqw] bg-[var(--website-chat-outgoing)] px-[3.5cqw] py-[2.3cqw] text-white">
                      Can I make Clucky even louder? 😅
                    </span>
                    <span className="max-w-[80%] self-start rounded-[4.2cqw] bg-[var(--website-chat-incoming)] px-[3.5cqw] py-[2.3cqw]">
                      Done 🐓 Max volume is on. No escape tomorrow.
                    </span>
                    <span className="max-w-[80%] self-end rounded-[4.2cqw] bg-[var(--website-chat-outgoing)] px-[3.5cqw] py-[2.3cqw] text-white">
                      lol ok thank you
                    </span>
                  </div>
                  <div className="flex shrink-0 items-end gap-[3cqw] px-[6cqw] pb-[8cqw]">
                    <span className="website-glass relative flex size-[10cqw] shrink-0 items-center justify-center rounded-full text-[5cqw]">+</span>
                    <span className="website-glass relative flex h-[10cqw] min-w-0 flex-1 items-center rounded-[5cqw] pl-[4cqw] text-[4.2cqw] text-[var(--website-chat-placeholder)]">
                      Message
                    </span>
                  </div>
                </div>
                <span className="absolute left-1/2 top-[1.8cqw] z-10 h-[1.2cqw] w-[10cqw] -translate-x-1/2 rounded-full bg-black/20" />
              </div>
            </PhoneFrame>
          </div>
        </div>
        <div className="absolute bottom-5 left-[10%] z-20 aspect-square w-[56px] [perspective:600px] sm:bottom-12 sm:left-[4%] sm:w-[clamp(72px,20%,104px)]">
          <div className="absolute inset-0 [transform-style:preserve-3d] sm:[transform:rotateY(-16deg)_rotateZ(-9deg)]">
            <div
              data-showcase-app="clucky"
              className="absolute inset-0 rounded-[24%] bg-[var(--landing-background)] shadow-[var(--showcase-icon-shadow)]"
            >
              <AppIcon app={appByName("Clucky")} className="size-full" radius="24%" />
              <span className="pointer-events-none absolute inset-0 rounded-[24%] shadow-[var(--showcase-icon-rim)] [background:var(--showcase-icon-sheen)]" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------ ai integration ------------------------------ */

const chip =
  "mx-0.5 inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-1 align-middle text-[.78em] font-medium leading-[1.2] tracking-[-.025em] sm:mx-1 sm:gap-1.5 sm:px-3 sm:py-1.5";

function Chip({ tone, icon, children }: { tone: "pink" | "blue" | "orange" | "green"; icon: ReactNode; children: ReactNode }) {
  return (
    <span className={chip} style={{ background: `var(--context-glass-${tone})`, color: `var(--context-ink-${tone})` }}>
      {icon}
      {children}
    </span>
  );
}

export function AiSentence() {
  return (
    <div className="flex min-h-0 flex-1 items-center">
      <div className="space-y-4 text-[20px] leading-[1.5] tracking-[-.035em] text-[var(--landing-foreground)] sm:space-y-6 sm:text-[clamp(24px,2.4vw,36px)] sm:leading-[1.55]">
        <p>
          go get a <Chip tone="pink" icon={<CoffeeIcon weight="bold" />}>coffee</Chip>, let ai{" "}
          <Chip tone="blue" icon={<LightningIcon weight="bold" />}>automate</Chip> your support.
        </p>
        <p>
          give{" "}
          <span role="img" aria-label="ChatGPT" className="relative mx-1 inline-block size-[1.1em] align-[-.16em]">
            <OpenAiLogoIcon className="size-full" />
          </span>{" "}
          your <Chip tone="orange" icon={<FileTextIcon weight="bold" />}>docs</Chip>, it&apos;ll reply better than{" "}
          <Chip tone="green" icon={<UserCircleIcon weight="bold" />}>you</Chip> probably anyway.
        </p>
      </div>
    </div>
  );
}

/* ------------------------------ telegram ------------------------------ */

export function TelegramVisual() {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center" aria-hidden="true">
      <div className="relative -mx-4 h-full w-[calc(100%+32px)] overflow-hidden [container-type:inline-size] sm:-mx-8 sm:w-[calc(100%+64px)]">
        <div className="absolute left-1/2 top-3 w-[88%] max-w-[520px] -translate-x-1/2 [filter:drop-shadow(var(--telegram-device-shadow))] sm:top-[40px]">
          <PhoneFrame screenClassName="bg-[var(--telegram-screen)]">
            <HomeScreen />
            <div className="absolute inset-x-[3cqw] top-[16cqw] flex flex-col gap-[2cqw]">
              <div className="relative flex animate-[bubble-in_.5s_.4s_cubic-bezier(.22,1,.36,1)_both] items-center gap-[3cqw] rounded-[6cqw] border border-[var(--telegram-glass-edge)] p-[3.5cqw] text-[3.6cqw] leading-[1.3] text-[var(--telegram-glass-ink)] shadow-[var(--telegram-glass-shadow)] backdrop-blur-xl backdrop-saturate-150 [background:var(--telegram-glass)]">
                <span className="flex size-[10cqw] shrink-0 items-center justify-center rounded-[3cqw] bg-[linear-gradient(#37aee2,#1e96c8)]">
                  <svg viewBox="0 0 24 24" className="size-[6cqw]" fill="#fff" aria-hidden="true">
                    <path d="M21.5 4.3 2.9 11.5c-1.3.5-1.3 1.2-.2 1.5l4.8 1.5 1.8 5.6c.2.6.1.9.8.9.5 0 .7-.2 1-.5l2.3-2.2 4.8 3.5c.9.5 1.5.2 1.7-.8l3.1-14.7c.3-1.3-.5-1.9-1.5-1.5ZM8.7 14.2l9.7-6.1c.5-.3.9-.1.5.2l-8.3 7.5-.3 3.4-1.6-5Z" />
                  </svg>
                </span>
                <div className="min-w-0 flex-1">
                  <div className="mb-[1cqw] flex items-center justify-between">
                    <span className="font-semibold">Telegram</span>
                    <span className="text-[2.8cqw] opacity-60">now</span>
                  </div>
                  <p className="truncate">Hey, can you help me restore my purchase?</p>
                </div>
              </div>
            </div>
          </PhoneFrame>
        </div>
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-14 bg-linear-to-t from-[var(--landing-panel)] to-transparent" />
      </div>
    </div>
  );
}

/* ------------------------------ multi tenancy ------------------------------ */

const tenants = [
  { app: "Clucky", unread: 2 },
  { app: "75 Days: Her Challenge", unread: 2 },
  { app: "Aesty", unread: 1 },
  { app: "StepKey", unread: 3 },
];

const tenantRows = [
  { name: "Ava", text: "Can I wake up to my own song?", unread: true, active: true },
  { name: "Max", text: "Can I change the rooster sound?", unread: true },
  { name: "Zoe", text: "Clucky is so loud lol, love it" },
];

export function MultiTenancyVisual() {
  return (
    <div aria-hidden="true" className="contents">
      <div className="relative -m-6 h-[calc(100%+48px)] w-[calc(100%+48px)] self-stretch overflow-hidden [mask-composite:intersect] [mask-image:linear-gradient(to_right,black_70%,transparent),linear-gradient(to_bottom,black_70%,transparent)]">
        <div className="absolute left-[10%] top-[14%] w-[480px] origin-top-left scale-[.85] sm:scale-[1.45]">
          <div className="flex h-[320px] w-full overflow-hidden rounded-[28px] bg-[var(--landing-background)] text-[var(--landing-foreground)] shadow-[0_0_0_1px_rgb(0_0_0_/_4%),0_2px_4px_rgb(0_0_0_/_3%),0_12px_32px_rgb(0_0_0_/_6%)] group-data-[theme=dark]/landing:[--landing-background:#2a2a2d] group-data-[theme=dark]/landing:[--landing-panel:#202023]">
            <div className="relative flex w-[76px] shrink-0 flex-col items-center gap-3.5 bg-[var(--landing-panel)] py-5">
              <span className="absolute left-0 top-7 h-7 w-1 rounded-full bg-[var(--landing-foreground)]" />
              {tenants.map((t) => (
                <span key={t.app} className="relative">
                  <AppIcon app={appByName(t.app)} className="size-11" radius="27%" />
                  <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-[#ff3b30] px-1.5 text-[11px] font-medium text-white">
                    {t.unread}
                  </span>
                </span>
              ))}
            </div>
            <div className="min-w-0 flex-1 px-4 py-5">
              <div className="mb-2 flex h-11 items-center gap-3 pl-6">
                <span className="text-[19px] tracking-[-.02em]">Clucky</span>
                <div className="flex -space-x-1.5">
                  {["A", "J", "S"].map((initial) => (
                    <span key={initial} className="rounded-full ring-2 ring-[var(--landing-background)]">
                      <span className="flex size-7 items-center justify-center rounded-full bg-linear-to-b from-[#a9adb6] to-[#868a93] text-[11px] font-medium text-white">
                        {initial}
                      </span>
                    </span>
                  ))}
                </div>
              </div>
              {tenantRows.map((row) => (
                <div key={row.name} className={`relative rounded-[14px] py-2.5 pl-6 pr-3 ${row.active ? "bg-[var(--landing-panel)]" : ""}`}>
                  {row.unread && <span className="absolute left-2 top-[17px] block size-2 rounded-full bg-[#0a84ff]" />}
                  <p className={`text-[15px] ${row.unread ? "font-medium" : ""}`}>{row.name}</p>
                  <p className="truncate text-[14px] text-[var(--landing-secondary)]">{row.text}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

