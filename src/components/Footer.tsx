"use client";

import Link from "next/link";
import { CircleHalfIcon } from "@phosphor-icons/react";
import { BrandMark } from "@/components/ui/BrandMark";
import { AccentLink } from "@/components/ui/Buttons";
import { FooterCar } from "@/components/art/FooterCar";
import { useLandingTheme } from "@/components/LandingShell";

const columns = [
  {
    title: "Product",
    links: [
      { href: "/#features", label: "Features" },
      { href: "/#reviews", label: "Request a review" },
      { href: "/#pricing", label: "Pricing" },
      { href: "/inbox", label: "Your inbox" },
    ],
  },
  {
    title: "Resources",
    links: [
      { href: "/docs", label: "Documentation" },
      { href: "/#how-it-works", label: "Getting started" },
      { href: "/#faq", label: "FAQ" },
    ],
  },
  {
    title: "Legal",
    links: [
      { href: "/terms", label: "Terms of service" },
      { href: "/privacy-policy", label: "Privacy policy" },
      { href: "/dpa", label: "Data processing agreement" },
    ],
  },
];

export function FooterCta() {
  return (
    <div className="relative isolate mx-auto mb-[calc(var(--landing-section-gap)-64px)] mt-[var(--landing-section-gap)] flex aspect-[1163/1353] w-full max-w-[560px] flex-col justify-end overflow-hidden rounded-[var(--landing-radius)] bg-[var(--landing-panel)] p-7 text-left text-[var(--footer-foreground)] sm:p-10">
      <FooterCar />
      <div aria-hidden="true" className="absolute inset-0 -z-10 bg-[image:var(--footer-shade)]" />
      <div className="flex flex-col items-start gap-6">
        <h2 className="text-balance text-[clamp(32px,4vw,44px)] leading-[1.1]">give them a reason to stay</h2>
        <AccentLink />
      </div>
    </div>
  );
}

export function Footer() {
  const { theme, toggle } = useLandingTheme();
  return (
    <footer className="pb-8">
      <div className="grid grid-cols-2 gap-10 px-3 py-16 text-sm md:grid-cols-[2fr_1fr_1fr_1fr]">
        <div className="col-span-2 md:col-span-1">
          <Link prefetch={false} aria-label="reception home" href="/" className="inline-flex min-h-11 items-center text-2xl">
            <BrandMark />
          </Link>
          <p className="mt-3 text-[var(--landing-secondary)]">By appmaxxers, for appmaxxers.</p>
        </div>
        {columns.map((col) => (
          <nav key={col.title} aria-label={col.title} className="flex flex-col items-start">
            <p className="mb-3 text-[var(--landing-secondary)]">{col.title}</p>
            {col.links.map((l) => (
              <Link prefetch={false} key={l.label} href={l.href} className="inline-flex min-h-10 items-center hover:text-[var(--landing-secondary)]">
                {l.label}
              </Link>
            ))}
          </nav>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-5 pl-3 text-xs text-[var(--landing-secondary)]">
        <span>© 2026 reception</span>
        <button
          type="button"
          onClick={toggle}
          aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          className="inline-flex min-h-10 cursor-pointer items-center gap-[7px] rounded-full [padding:7px_10px] text-[var(--landing-secondary)] [background:var(--feature-rim)] [border:1px_solid_var(--feature-border)] hover:text-[var(--landing-foreground)] focus-visible:[outline:2px_solid_var(--hero-accent)] focus-visible:[outline-offset:3px]"
        >
          <CircleHalfIcon size={14} weight="bold" />
          {theme === "dark" ? "light mode" : "dark mode"}
        </button>
      </div>
      <p className="mt-5 max-w-[40rem] pl-3 text-xs leading-relaxed text-[var(--landing-secondary)]">
        Apps built with reception have been approved by App Review across multiple apps and multiple submissions.
      </p>
    </footer>
  );
}
