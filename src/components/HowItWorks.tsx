import { ArrowUpIcon, FileTextIcon, PlusIcon } from "@radix-ui/react-icons";
import type { ReactNode } from "react";
import { AccentLink } from "@/components/ui/Buttons";
import { BrandMark } from "@/components/ui/BrandMark";

const miniCard =
  "w-full max-w-[290px] rounded-[20px] bg-[var(--landing-background)] shadow-[0_1px_3px_rgb(0_0_0/6%),0_8px_24px_rgb(0_0_0/4%)]";

function Step({ n, title, sub, children }: { n: number; title: string; sub: string; children: ReactNode }) {
  return (
    <li className="relative rounded-[var(--landing-radius)] bg-[var(--landing-panel)] px-[var(--landing-card-padding)] py-[var(--landing-card-padding-y)] sm:grid sm:grid-cols-2 sm:items-center sm:gap-10 xl:block">
      <div aria-hidden="true" className="flex h-56 items-center justify-center">
        {children}
      </div>
      <div>
        <p className="mt-6 text-[15px] text-[var(--landing-secondary)] sm:mt-0 xl:mt-6">{n}</p>
        <h3 className="mt-2 text-balance text-[24px] font-normal leading-[1.15] tracking-[-.03em]">{title}</h3>
        <p className="mt-1 text-[17px] tracking-[-.01em] text-[var(--landing-secondary)]">{sub}</p>
      </div>
    </li>
  );
}

function ClaudeMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-3.5 text-[var(--preview-claude)]" fill="currentColor" aria-hidden="true">
      {Array.from({ length: 8 }, (_, i) => (
        <rect key={i} x="11" y="2" width="2" height="9" rx="1" transform={`rotate(${i * 45} 12 12)`} />
      ))}
    </svg>
  );
}

export function HowItWorks() {
  return (
    <section
      id="how-it-works"
      aria-labelledby="how-it-works-title"
      className="flex min-h-svh scroll-mt-28 flex-col justify-center py-[calc(var(--landing-section-gap)/2)]"
    >
      <h2 id="how-it-works-title" className="text-center text-[clamp(40px,5vw,64px)] font-normal leading-[1.06] tracking-[-.045em]">
        one prompt setup
        <br />
        <span className="text-[var(--landing-secondary)]">live in minutes</span>
      </h2>
      <div className="mt-8 flex justify-center">
        <AccentLink />
      </div>
      <ol className="mx-auto mt-[var(--landing-heading-gap)] grid max-w-[880px] list-none gap-[var(--landing-card-gap)] xl:max-w-none xl:grid-cols-3">
        <Step n={1} title="add your app to reception" sub="name and icon">
          <span className={`${miniCard} flex flex-col gap-3 p-4`}>
            <span className="text-[13px] font-medium">New app</span>
            <span className="flex items-center gap-3">
              <span className="flex size-11 shrink-0 items-center justify-center rounded-[22%] border border-dashed border-[var(--landing-muted)] text-[var(--landing-secondary)]">
                <PlusIcon />
              </span>
              <span className="flex h-11 flex-1 items-center rounded-xl bg-[var(--landing-panel)] px-3 text-[15px] text-[var(--landing-secondary)]">
                <span className="mr-px h-4 w-px animate-pulse bg-[var(--landing-accent)]" />
                App name
              </span>
            </span>
            <span className="flex h-10 items-center justify-center rounded-full bg-[var(--landing-foreground)] text-[14px] text-[var(--landing-background)]">
              Add app
            </span>
          </span>
        </Step>
        <Step n={2} title="integrate with one prompt" sub="paste it into your coding agent">
          <span className={`${miniCard} flex flex-col gap-3 p-3.5`}>
            <span className="flex w-fit items-center gap-2.5 rounded-xl border border-[var(--landing-foreground)]/10 py-2 pl-2 pr-4">
              <span className="flex size-8 items-center justify-center rounded-lg bg-[var(--landing-panel)] text-[var(--landing-secondary)]">
                <FileTextIcon />
              </span>
              <span className="flex flex-col leading-tight">
                <span className="text-[12px]">setup prompt</span>
                <span className="text-[11px] text-[var(--landing-secondary)]">142 lines</span>
              </span>
            </span>
            <span className="text-balance px-1 text-[15px] leading-snug">add reception to my app</span>
            <span className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-[12px] text-[var(--landing-secondary)]">
                <span className="flex size-7 items-center justify-center rounded-full border border-[var(--landing-foreground)]/10">
                  <PlusIcon width={12} height={12} />
                </span>
                <ClaudeMark />
                Opus 5.5
              </span>
              <span className="flex size-8 items-center justify-center rounded-lg bg-[var(--preview-claude)] text-white">
                <ArrowUpIcon />
              </span>
            </span>
          </span>
        </Step>
        <Step n={3} title="ready to chat" sub="your users can reach you">
          <span className={`${miniCard} flex flex-col overflow-hidden`}>
            <span className="px-4 pt-3.5 text-[16px]">
              <BrandMark />
            </span>
            <span className="flex flex-col p-2">
              {[
                { i: "M", name: "Mia", time: "now", text: "is there a dark mode?", unread: true },
                { i: "L", name: "Leon", time: "2m", text: "thanks, works again!", unread: false },
              ].map((row) => (
                <span key={row.name} className={`flex items-center gap-3 rounded-xl px-2.5 py-2 ${row.unread ? "bg-[var(--landing-panel)]" : ""}`}>
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[var(--landing-foreground)]/[.08] text-[12px]">
                    {row.i}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col leading-tight">
                    <span className="flex justify-between text-[13px]">
                      <span>{row.name}</span>
                      <span className="text-[11px] text-[var(--landing-secondary)]">{row.time}</span>
                    </span>
                    <span className={`truncate text-[12px] ${row.unread ? "" : "text-[var(--landing-secondary)]"}`}>{row.text}</span>
                  </span>
                  {row.unread && <span className="size-2 shrink-0 rounded-full bg-[var(--preview-blue)]" />}
                </span>
              ))}
            </span>
          </span>
        </Step>
      </ol>
    </section>
  );
}
