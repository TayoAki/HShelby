import { ChatScreen, PhoneFrame, StatusBar } from "@hshelby/ui";
import Image from "next/image";

const phone = "w-[min(320px,62%)] [filter:drop-shadow(0_18px_24px_rgb(0_0_0/14%))]";

/** App Store listing mock that fills in as the developer picks their app. */
export function StoreListingPreview({ name, iconUrl, seller }: { name?: string; iconUrl?: string | null; seller?: string | null }) {
  return (
    <PhoneFrame className={phone}>
      <div className="absolute inset-0 bg-white text-black [font-family:-apple-system,BlinkMacSystemFont,'Segoe_UI',sans-serif]">
        <StatusBar />
        <div className="px-[6cqw] pt-[21cqw]">
          <div className="flex gap-[4cqw]">
            {iconUrl ? (
              <Image src={iconUrl} alt="" width={120} height={120} unoptimized className="size-[26cqw] rounded-[22%] outline outline-1 -outline-offset-1 outline-black/5" />
            ) : (
              <span className="size-[26cqw] shrink-0 rounded-[22%] bg-[#f2f2f7]" />
            )}
            <div className="min-w-0 pt-[1cqw]">
              <p className="truncate text-[5cqw] font-semibold leading-tight">{name || "Your app"}</p>
              <p className="truncate text-[3.4cqw] text-[#8e8e93]">{seller || "On the App Store"}</p>
              <span className="mt-[3cqw] inline-flex rounded-full bg-[var(--ios-blue)] px-[5cqw] py-[1.6cqw] text-[3.6cqw] font-semibold text-white">Get</span>
            </div>
          </div>
          <div className="mt-[6cqw] grid grid-cols-3 border-y border-[#e5e5ea] py-[4cqw] text-center text-[2.6cqw] uppercase tracking-wide text-[#8e8e93]">
            {["Ratings", "Chart", "Age"].map((label) => (
              <span key={label} className="flex flex-col items-center gap-[1.6cqw]">
                {label}
                <span className="h-[3cqw] w-[10cqw] rounded-full bg-[#f2f2f7]" />
              </span>
            ))}
          </div>
          <div className="mt-[6cqw] grid grid-cols-2 gap-[3cqw]">
            <span className="aspect-[9/16] rounded-[4cqw] bg-[#f2f2f7]" />
            <span className="aspect-[9/16] rounded-[4cqw] bg-[#f2f2f7]" />
          </div>
        </div>
      </div>
    </PhoneFrame>
  );
}

/** The chat as the app's users will see it, waiting for the first message from the SDK. */
export function ChatWaitingPreview({ received }: { received: boolean }) {
  return (
    <PhoneFrame className={phone}>
      <ChatScreen>
        <div className="flex flex-1 items-center justify-center">
          <p className="flex items-center gap-[1.5cqw] text-[3cqw] text-[#8e8e93]">
            <span
              className={`size-[1.6cqw] rounded-full ${received ? "bg-[#34c759]" : "animate-[pulse-dot_1.4s_ease-in-out_infinite] bg-[var(--ios-blue)]"}`}
            />
            {received ? "First message received" : "Waiting for your app's first message"}
          </p>
        </div>
      </ChatScreen>
    </PhoneFrame>
  );
}
