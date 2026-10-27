import type { ReactNode } from "react";
import { FeatureCard } from "@/components/features/FeatureCard";
import { LanguagesTicker } from "@/components/features/LanguagesTicker";
import { AiSentence, MultiTenancyVisual, NativeChatVisual, TelegramVisual } from "@/components/features/Visuals";

const providers = [
  { key: "swift", label: "Swift", glyph: "S" },
  { key: "expo", label: "Expo", glyph: "Λ" },
  { key: "react-native", label: "React Native", glyph: "⚛" },
];

function FeatureRow({
  id,
  title,
  subtitle,
  cardFirst = false,
  eyebrow,
  children,
}: {
  id: string;
  title: string;
  subtitle: string;
  cardFirst?: boolean;
  eyebrow?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="grid scroll-mt-28 grid-cols-1 items-center gap-10 lg:grid-cols-2 lg:gap-20">
      <div className={cardFirst ? "lg:order-2" : ""}>
        {eyebrow}
        <h2 id={`${id}-title`} className="text-balance text-[clamp(36px,4.6vw,68px)] leading-[1.08] tracking-[-.045em] !normal-case">
          {title}
          <span className="block whitespace-pre-line text-[var(--landing-muted)]">{subtitle}</span>
        </h2>
      </div>
      <div
        className={`aspect-square w-full sm:aspect-[4/3] lg:aspect-square lg:max-w-[600px] ${cardFirst ? "lg:order-1" : "lg:justify-self-end"}`}
      >
        <div className="h-full [&>article]:h-full">{children}</div>
      </div>
    </section>
  );
}

const panelPadding = "p-4 pb-5 sm:p-8 sm:pb-5";

export function SupportFeatures() {
  return (
    <section id="support-features" aria-label="Support features" className="scroll-mt-28 pb-[var(--landing-section-gap)] pt-[var(--landing-section-gap)]">
      <div className="space-y-[var(--landing-section-gap)]">
        <FeatureRow
          id="native"
          title="native chat"
          subtitle={"looks like you\nbuilt it yourself"}
          eyebrow={
            <ul aria-label="Works with" className="mb-5 flex flex-wrap gap-2">
              {providers.map((p) => (
                <li
                  key={p.key}
                  data-provider={p.key}
                  className="flex items-center gap-1.5 rounded-full bg-[var(--provider-glass)] px-3 py-1.5 text-[13px] font-medium leading-none tracking-[-.01em] text-[var(--provider-ink)] sm:text-sm"
                >
                  <span aria-hidden="true" className="grid size-4 shrink-0 place-items-center text-[12px] font-bold">
                    {p.glyph}
                  </span>
                  {p.label}
                </li>
              ))}
            </ul>
          }
        >
          <FeatureCard
            id="native"
            label="native chat"
            className={panelPadding}
            details={[
              "Your colors, your font, your words",
              "You decide where support lives in your app",
              "Remote config: change colors and texts without an app update",
            ]}
          >
            <NativeChatVisual />
          </FeatureCard>
        </FeatureRow>

        <FeatureRow id="context" title="ai integration" subtitle="automate your support" cardFirst>
          <FeatureCard
            id="context"
            label="ai integration"
            className="justify-center px-6 py-20 sm:px-12"
            details={["Answers from your own docs", "Replies instantly, day and night", "Hands over to you when it's unsure"]}
          >
            <AiSentence />
          </FeatureCard>
        </FeatureRow>

        <FeatureRow id="notifications" title="telegram integration" subtitle="reply from the beach or the gym">
          <FeatureCard
            id="notifications"
            label="telegram integration"
            className={panelPadding}
            details={["New messages land in Telegram", "Reply there, it reaches your user", "One group for your whole team"]}
          >
            <TelegramVisual />
          </FeatureCard>
        </FeatureRow>

        <FeatureRow id="inbox" title="multi tenancy" subtitle="all your apps, all your team" cardFirst>
          <FeatureCard
            id="inbox"
            label="multi tenancy"
            className="items-center justify-center p-6"
            details={["One inbox across your apps", "Stay on top of unread messages", "Give your team a shared view"]}
          >
            <MultiTenancyVisual />
          </FeatureCard>
        </FeatureRow>

        <FeatureRow id="languages" title="every language, every user" subtitle="make everyone feel at home">
          <FeatureCard
            id="languages"
            label="every language, every user"
            className={panelPadding}
            details={["Support your users in any language", "Auto-detects the device language", "Localize your own welcome text"]}
          >
            <div className="flex min-h-0 flex-1 items-center justify-center" aria-hidden="true">
              <LanguagesTicker />
            </div>
          </FeatureCard>
        </FeatureRow>
      </div>
    </section>
  );
}
