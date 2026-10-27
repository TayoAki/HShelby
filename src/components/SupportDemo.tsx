import { AccentLink } from "@/components/ui/Buttons";
import { PhoneFrame } from "@/components/ui/PhoneFrame";
import { DisplayStand } from "@/components/art/Devices";
import { InboxPreview, thread } from "@/components/preview/InboxPreview";
import { Bubble, ChatScreen, Timestamp } from "@/components/chat/Chat";

export function SupportDemo() {
  return (
    <section
      aria-labelledby="support-demo-title"
      className="flex min-h-svh flex-col justify-center py-[calc(var(--landing-section-gap)/2)]"
    >
      <h2
        id="support-demo-title"
        className="mb-[var(--landing-heading-gap)] text-balance text-center text-[clamp(34px,4vw,60px)] leading-[1.12]"
      >
        speak to your users
        <span className="block text-[var(--landing-secondary)]">stop them from churning</span>
      </h2>
      <div className="relative overflow-hidden rounded-[var(--landing-radius)] bg-[var(--landing-panel)] pt-8 sm:pt-12 lg:pt-[60px]">
        <figure
          aria-label="Product demo: the same support conversation in the reception dashboard and the iPhone app"
          className="relative w-full [container-type:inline-size]"
        >
          <div className="relative h-[98cqw] sm:h-[84cqw] lg:absolute lg:inset-0 lg:h-auto">
            <div className="absolute left-6 top-0 w-[125%] sm:left-12 sm:w-[112%] lg:left-[60px] lg:w-[calc(100%-120px)]">
              <DisplayStand />
              <div
                aria-hidden="true"
                className="relative overflow-hidden rounded-[1.2cqw] p-[.65cqw] shadow-[var(--device-lid-shadow)] [background:var(--device-bezel)] [container-type:inline-size]"
              >
                <div className="aspect-[5544/3144] overflow-hidden rounded-[.55cqw] shadow-[var(--device-screen-edge)] [container-type:inline-size]">
                  <InboxPreview />
                </div>
              </div>
            </div>
            <div className="absolute right-[8%] top-[24cqw] w-[36%] sm:right-[10%] sm:top-[20cqw] sm:w-[30%] lg:-bottom-[11cqw] lg:right-[2%] lg:top-auto lg:w-[29%]">
              <PhoneFrame className="w-full [filter:drop-shadow(var(--phone-frame-shadow))]">
                <ChatScreen>
                  <div className="flex flex-col gap-[3cqw]">
                    <Timestamp />
                    {/* the user's side of the conversation: their messages are outgoing */}
                    {thread.map((m) => (
                      <Bubble key={m.text} outgoing={!m.outgoing}>
                        {m.text}
                      </Bubble>
                    ))}
                  </div>
                </ChatScreen>
              </PhoneFrame>
            </div>
          </div>
          <div aria-hidden="true" className="mx-[60px] hidden p-[.65cqw] lg:block">
            <div className="aspect-[5544/3144]" />
          </div>
          <figcaption className="relative z-10 px-6 pb-8 pt-2 sm:grid sm:grid-cols-2 sm:gap-x-10 sm:px-12 sm:pb-12 lg:ml-[60px] lg:block lg:w-[30%] lg:px-0 lg:pb-[60px] lg:pr-[2cqw] lg:pt-[60px]">
            <h3 className="text-[26px] leading-[1.15] tracking-[-.03em] sm:text-[32px] lg:text-[clamp(24px,2.4vw,32px)]">
              in app support
              <br />
              <span className="text-[var(--landing-secondary)]">increase revenue</span>
            </h3>
            <div>
              <p className="mt-4 text-[16px] leading-[1.55] text-[var(--landing-secondary)] sm:mt-1 lg:mt-4 lg:text-[clamp(15px,1.3vw,18px)]">
                Lower churn by actually solving the users problems. Get more reviews, upsell across plans, or offer
                discounts. Fully native, within your app. It just works.
              </p>
              <div className="mt-6">
                <AccentLink />
              </div>
            </div>
          </figcaption>
        </figure>
      </div>
    </section>
  );
}
