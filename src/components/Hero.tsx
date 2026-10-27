import { AccentLink, PanelLink } from "@/components/ui/Buttons";
import { RotatingHeadline } from "@/components/RotatingHeadline";

export function Hero() {
  return (
    <section
      aria-labelledby="hero-title"
      className="mx-auto max-w-[var(--landing-content-width)] px-[var(--landing-gutter)] pt-[var(--landing-hero-top)]"
    >
      <div className="text-center">
        <h1
          id="hero-title"
          className="text-balance text-[clamp(36px,10vw,48px)] font-normal leading-[1.12] tracking-[-.05em] sm:text-[clamp(38px,4.5vw,72px)]"
        >
          agentic in app support
          <RotatingHeadline />
          <span className="sr-only">Increase conversion, lower churn, get more reviews</span>
        </h1>
        <h2 className="mx-auto mt-6 max-w-[36rem] text-balance text-[15px] leading-[1.6] tracking-[-.013em]! text-[var(--landing-secondary)] normal-case! sm:text-[16px]">
          Talk to users right inside your app. Solve problems before they churn, ask happy customers for reviews, and turn
          conversations into upgrades.
        </h2>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-x-3 gap-y-3 sm:gap-x-6">
          <AccentLink />
          <PanelLink href="/docs">Read the docs</PanelLink>
        </div>
      </div>
    </section>
  );
}
