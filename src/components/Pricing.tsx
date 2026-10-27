import { CheckIcon } from "@radix-ui/react-icons";
import { AccentLink } from "@/components/ui/Buttons";

const included = [
  "Native iOS chat and photo sharing",
  "Review requests and in-app offers",
  "Your colors, fonts and welcome screen",
  "User details, plans and metadata",
  "Push notifications and Telegram replies",
  "One inbox for your apps and team",
];

export function Pricing() {
  return (
    <section
      id="pricing"
      aria-labelledby="pricing-title"
      className="flex min-h-svh scroll-mt-28 flex-col justify-center py-[calc(var(--landing-section-gap)/2)]"
    >
      <h2 id="pricing-title" className="mb-[var(--landing-heading-gap)] text-center text-[clamp(34px,4vw,60px)] leading-[1.12]">
        no bulls**t pricing
        <br />
        <span className="text-[var(--landing-muted)]">one flat price</span>
      </h2>
      <article className="grid overflow-hidden rounded-[var(--landing-radius)] bg-[var(--landing-panel)] lg:grid-cols-2">
        <div className="flex flex-col items-start px-[var(--landing-card-padding)] py-[var(--landing-card-padding-y)]">
          <p className="flex flex-wrap items-baseline gap-x-4 gap-y-2 text-[clamp(56px,7vw,92px)] leading-none tracking-[-.055em] text-[var(--landing-foreground)]">
            $25
            <span className="text-base tracking-normal text-[var(--landing-secondary)]">per month</span>
          </p>
          <p className="mb-9 mt-7 max-w-md text-pretty text-[clamp(20px,2vw,26px)] leading-[1.45] tracking-[-.025em] text-[var(--landing-secondary)]">
            41/50 spots claimed.
            <br />
            <span className="text-[var(--landing-foreground)]">
              Next price: <span className="text-[var(--landing-accent)]">$50/m</span>
            </span>
          </p>
          <div className="mt-auto">
            <AccentLink />
          </div>
        </div>
        <div className="border-t border-[var(--feature-border)] lg:border-l lg:border-t-0">
          <div className="px-[var(--landing-card-padding)] py-[var(--landing-card-padding-y)]">
            <h3 className="mb-6 text-[26px] leading-tight">everything you need, included</h3>
            <ul className="space-y-4 text-[15px] text-[var(--landing-secondary)]">
              {included.map((item) => (
                <li key={item} className="flex items-start gap-3">
                  <CheckIcon aria-hidden="true" className="mt-[3px] shrink-0 text-[var(--landing-accent)]" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
          <a
            href="mailto:hello@reception.sh"
            className="group block border-t border-[var(--feature-border)] px-[var(--landing-card-padding)] py-[var(--landing-card-padding-y)]"
          >
            <h3 className="mb-3 text-[22px]">enterprise?</h3>
            <p className="text-pretty text-base leading-relaxed text-[var(--landing-secondary)]">
              doing over 30k/mo in revenue or have 10k+ active users
              <br />
              <span className="text-[var(--landing-foreground)] underline-offset-4 group-hover:underline">get in touch with us for pricing</span>
              <span aria-hidden="true">↗</span>
            </p>
          </a>
        </div>
      </article>
    </section>
  );
}
