"use client";

import type { InboxConversation, InboxList } from "@hshelby/contracts";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { BillingBanner } from "@/components/billing";
import { VerifiedSeal } from "@/components/inbox/Identity";
import { deviceLabel, InboxContext } from "@/components/inbox/InboxContext";
import { AppIcon, ErrorNote } from "@/components/ui";
import { api } from "@/lib/api";
import { useBilling } from "@/lib/billing";
import { relativeTime } from "@/lib/time";
import { useVisibleInterval } from "@/lib/use-visible-interval";

type Tab = "open" | "closed";

const newestFirst = (a: InboxConversation, b: InboxConversation) =>
  b.lastMessageAt.localeCompare(a.lastMessageAt) || b.id.localeCompare(a.id);

function ConversationRow({ conversation: c, selected }: { conversation: InboxConversation; selected: boolean }) {
  const unread = c.unreadForTeam > 0;
  return (
    <li>
      <Link
        href={`/inbox/${c.id}`}
        aria-current={selected ? "page" : undefined}
        className={`flex gap-3 rounded-2xl p-3 transition-colors ${selected ? "bg-panel" : "hover:bg-panel/70"}`}
      >
        <AppIcon app={c.app} size={40} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className={`flex min-w-0 items-center gap-1 text-[15px] ${unread ? "font-semibold" : ""}`}>
              <span className="truncate">{deviceLabel(c.device)}</span>
              {c.device.verified && <VerifiedSeal size={14} />}
            </span>
            <time dateTime={c.lastMessageAt} className="shrink-0 text-[12px] text-secondary">
              {relativeTime(c.lastMessageAt)}
            </time>
          </div>
          <div className="mt-0.5 flex items-center gap-2">
            <p className={`min-w-0 flex-1 truncate text-[13px] ${unread ? "text-fg" : "text-secondary"}`}>
              {c.lastMessage?.sender === "agent" && <span className="text-secondary">Team: </span>}
              {c.lastMessage?.text}
            </p>
            {unread && (
              <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-[var(--accent)] px-1.5 text-[11px] font-medium text-white">
                {c.unreadForTeam}
              </span>
            )}
          </div>
          <p className="mt-0.5 truncate text-[12px] text-muted">{c.app.name}</p>
        </div>
      </Link>
    </li>
  );
}

export default function InboxLayout({ children }: LayoutProps<"/inbox">) {
  const { conversationId } = useParams<{ conversationId?: string }>();
  const [tab, setTab] = useState<Tab>("open");
  const [firstPage, setFirstPage] = useState<InboxList | null>(null);
  const [older, setOlder] = useState<InboxConversation[]>([]);
  /** Cursor after the last "Load more" page; undefined until the first one. */
  const [olderCursor, setOlderCursor] = useState<string | null>();
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [q, setQ] = useState("");
  const { billing } = useBilling();

  const listPath = useCallback(
    (cursor?: string) =>
      `/conversations?status=${tab}&limit=50${q ? `&q=${encodeURIComponent(q)}` : ""}${cursor ? `&cursor=${cursor}` : ""}`,
    [tab, q],
  );

  // search as you type, once typing pauses
  useEffect(() => {
    const id = setTimeout(() => {
      setQ(query.trim());
      setOlder([]);
      setOlderCursor(undefined);
    }, 250);
    return () => clearTimeout(id);
  }, [query]);

  const refresh = useCallback(() => {
    api<InboxList>(listPath())
      .then((list) => {
        setFirstPage(list);
        setError(null);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Couldn't load the inbox"));
  }, [listPath]);

  useEffect(() => refresh(), [refresh]);
  useVisibleInterval(refresh, 5000);

  // Polling refreshes the first page; pages loaded with "Load more" stay, minus anything that moved.
  const conversations = useMemo(() => {
    if (!firstPage) return null;
    const ids = new Set(firstPage.conversations.map((c) => c.id));
    return [...firstPage.conversations, ...older.filter((c) => !ids.has(c.id) && c.status === tab)].sort(newestFirst);
  }, [firstPage, older, tab]);

  const nextCursor = olderCursor === undefined ? (firstPage?.nextCursor ?? null) : olderCursor;

  function loadMore() {
    if (!nextCursor) return;
    api<InboxList>(listPath(nextCursor))
      .then((list) => {
        setOlder((prev) => [...prev, ...list.conversations]);
        setOlderCursor(list.nextCursor);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Couldn't load more"));
  }

  function switchTab(next: Tab) {
    setTab(next);
    setFirstPage(null);
    setOlder([]);
    setOlderCursor(undefined);
  }

  const context = useMemo(() => ({ conversations, refresh }), [conversations, refresh]);

  return (
    <InboxContext value={context}>
      <div className="flex h-svh flex-col">
        <AppHeader className="border-b border-line px-5" />
        <BillingBanner billing={billing} />
        <div className="flex min-h-0 flex-1">
          <aside
            className={`w-full shrink-0 flex-col border-r border-line md:flex md:w-[340px] ${conversationId ? "hidden" : "flex"}`}
          >
            <div className="flex items-center justify-between px-5 pt-5 pb-3">
              <h1 className="text-[24px] tracking-[-.03em]">Inbox</h1>
              <div role="tablist" className="flex rounded-full bg-panel p-1 text-[13px]">
                {(["open", "closed"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    role="tab"
                    aria-selected={tab === t}
                    onClick={() => switchTab(t)}
                    className={`rounded-full px-3 py-1 capitalize transition-colors ${tab === t ? "bg-white shadow-sm" : "text-secondary hover:text-fg"}`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
            <div className="px-5 pb-3">
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search name, email, user ID…"
                aria-label="Search conversations"
                className="h-10 w-full rounded-full bg-panel px-4 text-[14px] outline-none transition-shadow placeholder:text-muted focus:bg-white focus:shadow-[inset_0_0_0_1px_var(--field)]"
              />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
              {error && (
                <div className="px-3">
                  <ErrorNote>{error}</ErrorNote>
                </div>
              )}
              {!conversations && !error && <p className="px-3 py-6 text-[14px] text-secondary">Loading…</p>}
              {conversations?.length === 0 && (
                <p className="px-3 py-6 text-[14px] text-secondary">
                  {q ? "No matches." : tab === "open" ? "No open conversations." : "Nothing resolved yet."}
                </p>
              )}
              {conversations && conversations.length > 0 && (
                <ul className="space-y-0.5">
                  {conversations.map((c) => (
                    <ConversationRow key={c.id} conversation={c} selected={c.id === conversationId} />
                  ))}
                </ul>
              )}
              {nextCursor && (
                <button type="button" onClick={loadMore} className="mx-3 mt-2 text-[13px] text-secondary hover:text-fg">
                  Load more
                </button>
              )}
            </div>
          </aside>
          <main className={`min-w-0 flex-1 ${conversationId ? "flex" : "hidden md:flex"}`}>{children}</main>
        </div>
      </div>
    </InboxContext>
  );
}
