"use client";

import { useState, type ReactNode } from "react";
import { PlusIcon } from "@radix-ui/react-icons";
import { AccentLink } from "@/components/ui/Buttons";

const ease = "duration-200 ease-[var(--landing-ease-out)] motion-reduce:transition-none";

/** Rounded panel card with a "read more" toggle that fades in a details list. */
export function FeatureCard({
  id,
  label,
  details,
  className = "",
  children,
}: {
  id: string;
  label: string;
  details: string[];
  className?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <article
      aria-label={label}
      className={`group/feature relative isolate flex scroll-mt-28 flex-col overflow-hidden rounded-[var(--landing-radius)] bg-[var(--landing-panel)] ${className}`}
    >
      {children}
      <div
        id={`${id}-details`}
        role="region"
        aria-label={`${label} details`}
        aria-hidden={!open}
        inert={!open}
        className={`absolute inset-0 z-20 flex flex-col justify-center overflow-y-auto bg-[var(--landing-panel)] px-6 pb-16 transition-opacity sm:px-14 ${ease} ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      >
        <ul>
          {details.map((item) => (
            <li
              key={item}
              className="border-t border-[var(--feature-border)] py-3 text-[18px] leading-[1.25] tracking-[-.02em] first:border-t-0 sm:py-4 sm:text-[clamp(20px,2vw,26px)]"
            >
              {item}
            </li>
          ))}
        </ul>
        <div className="mt-6 sm:mt-8">
          <AccentLink />
        </div>
      </div>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={`${id}-details`}
        aria-label={`${open ? "Hide" : "Show"} ${label} details`}
        onClick={() => setOpen((v) => !v)}
        className={`absolute bottom-5 right-5 z-30 flex h-11 w-28 cursor-pointer items-center justify-center gap-1.5 overflow-hidden rounded-full bg-[var(--landing-background)] text-[var(--landing-foreground)] transition-transform active:scale-[.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current ${ease}`}
      >
        <PlusIcon width={16} height={16} aria-hidden="true" className={`shrink-0 transition-transform ${ease} ${open ? "rotate-45" : "rotate-0"}`} />
        <span aria-hidden="true" className="grid text-sm">
          <span className={`[grid-area:1/1] transition-opacity ${ease} ${open ? "opacity-0" : "opacity-100"}`}>read more</span>
          <span className={`[grid-area:1/1] transition-opacity ${ease} ${open ? "opacity-100" : "opacity-0"}`}>close</span>
        </span>
      </button>
    </article>
  );
}
