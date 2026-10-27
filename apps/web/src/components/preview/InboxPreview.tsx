import {
  ArrowUpIcon,
  CheckIcon,
  DashboardIcon,
  FileTextIcon,
  GearIcon,
  MagnifyingGlassIcon,
  MixerHorizontalIcon,
  PersonIcon,
  PlusIcon,
  ReaderIcon,
  StarIcon,
} from "@radix-ui/react-icons";
import { AppIcon, appByName } from "@/components/art/Avatars";

/* The reception web inbox as drawn on the landing page. Sized entirely in `cqw`
   of its container, so it scales with whatever device frame holds it. */

export const inboxRows = [
  { name: "Alex Morgan", time: "now", text: "bro ts app is ass 🥀", unread: 2, app: "75 Days: Her Challenge", active: true },
  { name: "Jamie Chen", time: "2m", text: "yooo it works now 🙌", unread: 1, app: "StepKey" },
  { name: "Sam Wilson", time: "12m", text: "wait lemme send a screenshot", app: "Aesty" },
  { name: "Taylor Reed", time: "24m", text: "does pro work on my ipad?", app: "75 Days: Her Challenge" },
  { name: "Jordan Lee", time: "1h", text: "How do I restore my purchase?", app: "StepKey" },
];

export const thread = [
  { outgoing: false, text: "bro ts app is ass 🥀" },
  { outgoing: true, text: "damn, yeah that sucks, let me fix it now" },
  { outgoing: false, text: "yooo that's crazy you actually replied wtf" },
  { outgoing: true, text: "nw man, we here for u 🫵 👑" },
];

const icon = "size-[1.4cqw]";

export function InboxPreview({ showThread = true }: { showThread?: boolean }) {
  return (
    <div className="flex h-full bg-[var(--preview-surface)] text-[1.12cqw] leading-[1.4] text-[var(--preview-ink)]">
      <aside className="flex w-[5%] shrink-0 flex-col items-center gap-[1.2cqw] py-[1.4cqw]">
        <span className="mb-[.6cqw] inline-block size-[1ex] rounded-full bg-[var(--brand-mark)] text-[1.8cqw]" />
        <DashboardIcon className={`${icon} text-[var(--preview-muted)]`} />
        <span className="relative rounded-[.5cqw] bg-[var(--preview-bubble)] p-[.6cqw]">
          <ReaderIcon className={icon} />
          <span className="absolute -right-[.5cqw] -top-[.5cqw] flex size-[1.3cqw] items-center justify-center rounded-full bg-[var(--preview-blue)] text-[.75cqw] font-semibold text-white">
            3
          </span>
        </span>
        <PersonIcon className={`${icon} text-[var(--preview-muted)]`} />
        <FileTextIcon className={`${icon} mt-auto text-[var(--preview-muted)]`} />
        <GearIcon className={`${icon} text-[var(--preview-muted)]`} />
        <span className="size-[1.8cqw] rounded-full bg-[var(--preview-bubble)]" />
      </aside>
      <div className="my-[.6cqw] mr-[.6cqw] flex min-w-0 flex-1 overflow-hidden rounded-[1cqw] bg-[var(--preview-white)] shadow-[0_0_0_1px_var(--preview-line),0_.2cqw_.8cqw_rgba(0,0,0,.06)]">
        <div className={`flex shrink-0 flex-col border-r border-[var(--preview-line)] ${showThread ? "w-[34%]" : "w-full"}`}>
          <div className="space-y-[.9cqw] border-b border-[var(--preview-line)] p-[1.3cqw]">
            <p className="text-[1.6cqw] font-medium tracking-tight">Inbox</p>
            <span className="flex items-center gap-[.6cqw] rounded-[.7cqw] bg-[var(--preview-surface)] px-[1cqw] py-[.7cqw] text-[var(--preview-muted)]">
              <MagnifyingGlassIcon className="size-[1.3cqw]" />
              Search
              <span className="ml-auto text-[.85cqw]">⌘K</span>
            </span>
            <div className="flex items-center gap-[.3cqw] text-[.95cqw] text-[var(--preview-muted)]">
              <span className="rounded-full bg-[var(--preview-bubble)] px-[.9cqw] py-[.5cqw] text-[var(--preview-ink)]">
                Open <span className="text-[var(--preview-muted)]">5</span>
              </span>
              <span className="px-[.9cqw] py-[.5cqw]">Closed 12</span>
              <span className="px-[.9cqw] py-[.5cqw]">All 17</span>
              <MixerHorizontalIcon className="ml-auto size-[1.2cqw]" />
            </div>
          </div>
          {inboxRows.map((row) => (
            <div
              key={row.name}
              className={`border-b border-[var(--preview-line)] px-[1.3cqw] py-[1.1cqw] ${row.active ? "bg-[var(--preview-surface)]" : ""}`}
            >
              <div className="flex items-center gap-[.6cqw]">
                <p className={`min-w-0 flex-1 truncate ${row.unread ? "font-semibold" : ""}`}>{row.name}</p>
                <span
                  className={`text-[.85cqw] tabular-nums ${row.unread ? "font-semibold text-[var(--preview-blue)]" : "text-[var(--preview-muted)]"}`}
                >
                  {row.time}
                </span>
              </div>
              <div className="mt-[.4cqw] flex items-center gap-[.6cqw]">
                <p className="min-w-0 flex-1 truncate text-[.95cqw] text-[var(--preview-muted)]">{row.text}</p>
                {row.unread && (
                  <span className="flex size-[1.3cqw] items-center justify-center rounded-full bg-[var(--preview-blue)] text-[.75cqw] font-medium text-white">
                    {row.unread}
                  </span>
                )}
                <AppIcon app={appByName(row.app)} className="size-[1.3cqw]" radius=".3cqw" />
              </div>
            </div>
          ))}
        </div>
        {showThread && (
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex items-center gap-[.8cqw] border-b border-[var(--preview-line)] px-[1.6cqw] py-[1.2cqw]">
              <div className="min-w-0 flex-1">
                <p className="text-[1.3cqw] font-medium">Alex Morgan</p>
                <p className="mt-[.3cqw] flex items-center gap-[.4cqw] text-[.85cqw] text-[var(--preview-muted)]">
                  <AppIcon app={appByName("75 Days: Her Challenge")} className="size-[1.2cqw]" radius=".3cqw" />
                  Her Challenge <span>· English</span>
                </p>
              </div>
              <StarIcon className="size-[1.3cqw] text-[var(--preview-muted)]" />
              <span className="flex items-center gap-[.4cqw] rounded-full bg-[var(--preview-surface)] px-[.9cqw] py-[.6cqw] text-[.9cqw]">
                <CheckIcon className="size-[1.2cqw]" />
                Mark resolved
              </span>
            </div>
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden py-[1.4cqw] pl-[1.6cqw] pr-[7cqw]">
              <p className="mb-[1.6cqw] shrink-0 text-center text-[.85cqw] text-[var(--preview-muted)]">Today, 9:41 AM</p>
              <div className="flex min-h-0 flex-1 flex-col gap-[.65em] overflow-hidden">
                {thread.map((m) => (
                  <div
                    key={m.text}
                    className={`max-w-[85%] shrink-0 rounded-[1.15em] px-[1em] py-[.7em] leading-[1.4] ${
                      m.outgoing
                        ? "self-end bg-[var(--preview-blue)] text-white"
                        : "self-start bg-[var(--preview-bubble)] text-[var(--preview-ink)]"
                    }`}
                  >
                    {m.text}
                  </div>
                ))}
              </div>
            </div>
            <div className="mb-[1.2cqw] ml-[1.6cqw] mr-[7cqw] flex items-center justify-between rounded-[1.2cqw] border border-[var(--preview-line)] bg-[var(--preview-surface)] px-[1.1cqw] py-[.8cqw] text-[var(--preview-muted)]">
              <span className="flex items-center gap-[.6cqw]">
                <PlusIcon className="size-[1.3cqw]" />
                Write a reply…
              </span>
              <ArrowUpIcon className="size-[1.8cqw] rounded-full bg-[var(--preview-blue)] p-[.3cqw] text-white" />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
