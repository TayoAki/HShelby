import { BatteryFullIcon, CellSignalFullIcon, WifiHighIcon } from "@phosphor-icons/react/dist/ssr";
import { PlusIcon } from "@radix-ui/react-icons";
import type { CSSProperties, ReactNode } from "react";
import { Avatar } from "@/components/art/Avatars";

/* Building blocks of the reception SDK chat as drawn inside phone mocks.
   Every size is in `cqw` of the phone screen, copied from the original markup. */

export function StatusBar({ className = "" }: { className?: string }) {
  return (
    <div
      className={`absolute inset-x-0 top-0 z-20 flex h-[13cqw] items-center justify-between px-[9cqw] pt-[1cqw] text-[3.8cqw] font-semibold ${className}`}
    >
      <span>9:41</span>
      <span className="flex items-center gap-[1cqw]">
        <CellSignalFullIcon size="4cqw" weight="fill" />
        <WifiHighIcon size="4cqw" weight="bold" />
        <BatteryFullIcon size="5cqw" weight="fill" />
      </span>
    </div>
  );
}

export function ChatScreen({
  title = "Support",
  children,
  overlay,
  className = "",
  style,
  fixed = false,
}: {
  title?: string;
  children?: ReactNode;
  overlay?: ReactNode;
  className?: string;
  style?: CSSProperties;
  fixed?: boolean;
}) {
  return (
    <div
      data-website-support=""
      data-chat-fixed={fixed ? "" : undefined}
      style={style}
      className={`absolute inset-0 flex flex-col bg-[var(--website-chat-background)] text-[var(--website-chat-foreground)] [font-family:var(--website-chat-font)] ${className}`}
    >
      <StatusBar />
      <div className="absolute inset-x-0 top-0 z-10 h-[34cqw] bg-[linear-gradient(to_bottom,var(--website-chat-background)_30%,transparent)]" />
      <span className="website-glass absolute left-1/2 top-[16.3cqw] z-20 -translate-x-1/2 whitespace-nowrap rounded-full px-[4cqw] py-[2cqw] text-[4.2cqw] font-semibold leading-none">
        {title}
      </span>
      <div className="flex min-h-0 flex-1 flex-col gap-[2cqw] px-[4cqw] pb-[4cqw] pt-[34cqw]">{children}</div>
      <Composer />
      {overlay}
    </div>
  );
}

export function Composer() {
  return (
    <div className="flex shrink-0 items-end gap-[3cqw] px-[6cqw] pb-[8cqw]">
      <span className="website-glass relative flex size-[10cqw] shrink-0 items-center justify-center rounded-full">
        <PlusIcon width="5cqw" height="5cqw" />
      </span>
      <span className="website-glass relative flex h-[10cqw] min-w-0 flex-1 items-center rounded-[5cqw] pl-[4cqw] text-[4.2cqw] text-[var(--website-chat-placeholder)]">
        Message
      </span>
    </div>
  );
}

export function Timestamp({ children = "Today 9:41" }: { children?: ReactNode }) {
  return <p className="text-center text-[2.8cqw] text-[var(--website-chat-secondary)]">{children}</p>;
}

export function Bubble({ outgoing = false, children }: { outgoing?: boolean; children: ReactNode }) {
  return (
    <div
      className={`max-w-[86%] animate-[bubble-in_.35s_cubic-bezier(.22,1,.36,1)_both] rounded-[4.2cqw] px-[3.5cqw] py-[2.3cqw] text-[4.2cqw] leading-[1.3] ${
        outgoing
          ? "self-end bg-[var(--website-chat-outgoing)] text-[var(--website-chat-on-outgoing)]"
          : "self-start bg-[var(--website-chat-incoming)]"
      }`}
    >
      {children}
    </div>
  );
}

/** Incoming message from a teammate: small avatar + name above the bubble. */
export function TeamBubble({ name = "Andi", children }: { name?: string; children: ReactNode }) {
  return (
    <div className="flex animate-[bubble-in_.35s_cubic-bezier(.22,1,.36,1)_both] flex-col items-start gap-[1cqw]">
      <span className="flex items-center gap-[1.5cqw] px-[3cqw] text-[3cqw] text-[var(--website-chat-secondary)]">
        <Avatar name={name} className="size-[4.5cqw] text-[2.4cqw]" />
        {name}
      </span>
      <div className="max-w-[86%] self-start rounded-[4.2cqw] bg-[var(--website-chat-incoming)] px-[3.5cqw] py-[2.3cqw] text-[4.2cqw] leading-[1.3]">
        {children}
      </div>
    </div>
  );
}

export function SystemLine({ children }: { children: ReactNode }) {
  return (
    <p className="mx-auto mt-[1cqw] flex animate-[bubble-in_.35s_ease-out_both] items-center gap-[1.5cqw] text-[3.2cqw] text-[var(--website-chat-secondary)]">
      {children}
    </p>
  );
}

/** The action pill inside an offer / review card ("View offer ›"). */
export function CardAction({
  icon,
  label,
  pressed,
  used,
}: {
  icon: ReactNode;
  label: string;
  pressed: boolean;
  used: boolean;
}) {
  return (
    <>
      <span
        className={`mt-[2.5cqw] flex items-center gap-[2cqw] rounded-full px-[4cqw] py-[2.4cqw] text-[3.8cqw] font-semibold text-white transition-[background-color,scale,opacity] duration-200 ${
          used ? "bg-[#aeaeb2]" : "bg-[var(--website-chat-outgoing)]"
        } ${pressed ? "scale-[.94] opacity-75" : ""}`}
      >
        {icon}
        <span className="flex-1 text-center">{label}</span>
        <svg width="3.8cqw" height="3.8cqw" viewBox="0 0 15 15" fill="none" aria-hidden="true">
          <path
            d="M6.1584 3.13508C6.35985 2.94621 6.67627 2.95642 6.86514 3.15788L10.6151 7.15788C10.7954 7.3502 10.7954 7.64949 10.6151 7.84182L6.86514 11.8418C6.67627 12.0433 6.35985 12.0535 6.1584 11.8646C5.95694 11.6757 5.94673 11.3593 6.1356 11.1579L9.565 7.49985L6.1356 3.84182C5.94673 3.64036 5.95694 3.32394 6.1584 3.13508Z"
            fill="currentColor"
            fillRule="evenodd"
            clipRule="evenodd"
          />
        </svg>
      </span>
      {used && (
        <p className="mt-[1.5cqw] animate-[bubble-in_.3s_ease-out_both] text-[3cqw] text-[var(--website-chat-secondary)]">
          No longer available
        </p>
      )}
    </>
  );
}
