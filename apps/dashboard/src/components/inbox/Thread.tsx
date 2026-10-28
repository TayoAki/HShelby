"use client";

import { MESSAGE_MAX_LENGTH, type InboxConversation, type InboxMessage, type InboxThread } from "@hshelby/contracts";
import { ArrowLeftIcon, ArrowUpIcon } from "@radix-ui/react-icons";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { AppIcon, ErrorNote, Spinner } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import { clockTime, dayLabel, localTimeIn, relativeTime, sameDay } from "@/lib/time";
import { isAdmin, useMe } from "@/lib/use-me";
import { useVisibleInterval } from "@/lib/use-visible-interval";
import { IdentityBadge } from "./Identity";
import { deviceLabel, useInbox } from "./InboxContext";

/** A stored message, or one of ours still on its way (no seq yet). */
type Item = InboxMessage & { state?: "sending" | "failed" };

const GROUP_GAP_MS = 5 * 60_000;

/** Stored messages by seq, then pending sends; a pending send disappears once its clientId is stored. */
function merge(current: Item[], incoming: InboxMessage[]): Item[] {
  const stored = new Map<string, Item>();
  for (const m of current) if (!m.state) stored.set(m.id, m);
  for (const m of incoming) stored.set(m.id, m);
  const delivered = new Set([...stored.values()].map((m) => m.clientId).filter(Boolean));
  const pending = current.filter((m) => m.state && !delivered.has(m.clientId));
  return [...[...stored.values()].sort((a, b) => a.seq - b.seq), ...pending];
}

function endsGroup(m: Item, next: Item | undefined) {
  if (!next) return true;
  return (
    next.sender !== m.sender ||
    next.author?.id !== m.author?.id ||
    Date.parse(next.createdAt) - Date.parse(m.createdAt) > GROUP_GAP_MS ||
    !sameDay(next.createdAt, m.createdAt)
  );
}

function Detail({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex justify-between gap-4 py-2 text-[13px]">
      <dt className="shrink-0 text-secondary">{label}</dt>
      <dd className="truncate text-right" title={value ?? undefined}>
        {value ?? "—"}
      </dd>
    </div>
  );
}

function DetailsSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-5">
      <h2 className="text-[13px] text-secondary">{title}</h2>
      <dl className="mt-1 divide-y divide-line">{children}</dl>
    </section>
  );
}

export function Thread({ conversationId }: { conversationId: string }) {
  const { refresh } = useInbox();
  const router = useRouter();
  const me = useMe();
  const { data: session } = authClient.useSession();
  const [conversation, setConversation] = useState<InboxConversation | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [hasOlder, setHasOlder] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const restoreFromHeight = useRef<number | null>(null);

  const lastSeq = useMemo(() => items.reduce((max, m) => (m.state ? max : Math.max(max, m.seq)), 0), [items]);
  const base = `/conversations/${conversationId}`;

  useEffect(() => {
    Promise.all([api<{ conversation: InboxConversation }>(base), api<InboxThread>(`${base}/messages?limit=50`)])
      .then(([c, t]) => {
        setConversation(c.conversation);
        setItems(t.messages);
        setHasOlder(t.hasMore);
      })
      .catch((e: unknown) => {
        if (e instanceof ApiError && e.status === 404) setMissing(true);
        else setError(e instanceof Error ? e.message : "Couldn't load this conversation");
      });
  }, [base]);

  // New messages from the user: fetch what's after the last seq, then the conversation's fresh counters.
  useVisibleInterval(() => {
    if (!conversation) return;
    api<InboxThread>(`${base}/messages?after=${lastSeq}&limit=100`)
      .then(async (t) => {
        if (t.messages.length === 0) return;
        setItems((current) => merge(current, t.messages));
        const c = await api<{ conversation: InboxConversation }>(base);
        setConversation(c.conversation);
      })
      .catch(() => {});
  }, 3000);

  // Viewing the conversation reads it.
  useEffect(() => {
    if (!conversation || conversation.unreadForTeam === 0 || document.visibilityState !== "visible") return;
    api<{ unreadForTeam: number }>(`${base}/read`, { method: "POST", body: JSON.stringify({ seq: conversation.lastSeq }) })
      .then((r) => {
        setConversation((c) => c && { ...c, unreadForTeam: r.unreadForTeam });
        refresh();
      })
      .catch(() => {});
  }, [conversation, base, refresh]);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (restoreFromHeight.current !== null) {
      el.scrollTop += el.scrollHeight - restoreFromHeight.current;
      restoreFromHeight.current = null;
    } else if (stickToBottom.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [items]);

  async function send(text: string, clientId: string = crypto.randomUUID()) {
    const pending: Item = {
      id: `pending-${clientId}`,
      seq: Number.MAX_SAFE_INTEGER,
      sender: "agent",
      source: "dashboard",
      text,
      clientId,
      createdAt: new Date().toISOString(),
      author: session ? { id: session.user.id, name: session.user.name } : null,
      state: "sending",
    };
    stickToBottom.current = true;
    setItems((current) => [...current.filter((m) => !(m.state && m.clientId === clientId)), pending]);
    try {
      // Resending with the same clientId can't create a second copy.
      const { message } = await api<{ message: InboxMessage }>(`${base}/messages`, {
        method: "POST",
        body: JSON.stringify({ clientId, text }),
      });
      setItems((current) => merge(current, [message]));
      setConversation((c) => c && { ...c, lastSeq: Math.max(c.lastSeq, message.seq), unreadForTeam: 0 });
      refresh();
    } catch {
      setItems((current) => current.map((m) => (m.state && m.clientId === clientId ? { ...m, state: "failed" } : m)));
    }
  }

  function submit(e?: FormEvent) {
    e?.preventDefault();
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    void send(text);
  }

  async function loadOlder() {
    const first = items.find((m) => !m.state);
    if (!first || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const t = await api<InboxThread>(`${base}/messages?before=${first.seq}&limit=50`);
      restoreFromHeight.current = scroller.current?.scrollHeight ?? null;
      setItems((current) => merge(current, t.messages));
      setHasOlder(t.hasMore);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load older messages");
    } finally {
      setLoadingOlder(false);
    }
  }

  async function setStatus(action: "resolve" | "reopen") {
    try {
      const { status } = await api<{ status: InboxConversation["status"] }>(`${base}/${action}`, { method: "POST" });
      setConversation((c) => c && { ...c, status });
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't update the conversation");
    }
  }

  async function setBlocked(blocked: boolean) {
    if (!conversation) return;
    if (blocked && !window.confirm("Block this user? They can still read the conversation but can't send messages.")) return;
    try {
      const { device } = await api<{ device: InboxConversation["device"] }>(
        `/devices/${conversation.device.id}/${blocked ? "block" : "unblock"}`,
        { method: "POST" },
      );
      setConversation((c) => c && { ...c, device });
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't update the user");
    }
  }

  async function deleteUserData() {
    if (!conversation) return;
    const ok = window.confirm(
      "Delete this user's data? Their device record, identity, custom fields and every conversation and message are removed for good.",
    );
    if (!ok) return;
    try {
      await api(`/devices/${conversation.device.id}`, { method: "DELETE" });
      refresh();
      router.push("/inbox");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't delete this user's data");
    }
  }

  if (missing) {
    return (
      <div className="flex flex-1 items-center justify-center p-8 text-center text-[14px] text-secondary">
        This conversation doesn&apos;t exist in your workspace.
      </div>
    );
  }
  if (!conversation) {
    return <div className="flex-1">{error ? <div className="p-5"><ErrorNote>{error}</ErrorNote></div> : <Spinner />}</div>;
  }

  const { device, app } = conversation;
  const open = conversation.status === "open";

  return (
    <div className="flex min-w-0 flex-1">
      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-line px-5 py-3">
          <Link href="/inbox" aria-label="Back to inbox" className="-ml-1 rounded-full p-1 text-secondary hover:text-fg md:hidden">
            <ArrowLeftIcon width={18} height={18} />
          </Link>
          <AppIcon app={app} size={36} />
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1.5 text-[16px]">
              <span className="truncate">{deviceLabel(device)}</span>
              <IdentityBadge device={device} />
            </p>
            <p className="truncate text-[13px] text-secondary">
              {[device.name && device.email, app.name, device.model ?? "iOS device", !open && "Resolved"].filter(Boolean).join(" · ")}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setStatus(open ? "resolve" : "reopen")}
            className="h-9 shrink-0 rounded-full bg-panel px-4 text-[14px] transition-colors hover:bg-[var(--panel-hover)]"
          >
            {open ? "Resolve" : "Reopen"}
          </button>
        </header>

        <div
          ref={scroller}
          onScroll={(e) => {
            const el = e.currentTarget;
            stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
          }}
          className="min-h-0 flex-1 overflow-y-auto px-5 py-4"
        >
          {hasOlder && (
            <div className="mb-2 text-center">
              <button type="button" onClick={loadOlder} disabled={loadingOlder} className="text-[13px] text-secondary hover:text-fg">
                {loadingOlder ? "Loading…" : "Load earlier messages"}
              </button>
            </div>
          )}
          {items.map((m, i) => {
            const previous = items[i - 1];
            const agent = m.sender === "agent";
            const last = endsGroup(m, items[i + 1]);
            return (
              <Fragment key={m.id}>
                {(!previous || !sameDay(previous.createdAt, m.createdAt)) && (
                  <p className="my-4 text-center text-[12px] text-secondary">{dayLabel(m.createdAt)}</p>
                )}
                <div className={`mt-1 flex ${agent ? "justify-end" : "justify-start"}`}>
                  <p
                    className={`max-w-[75%] whitespace-pre-wrap break-words rounded-[20px] px-4 py-2.5 text-[15px] leading-[1.4] ${
                      agent ? "bg-[var(--accent)] text-white" : "bg-panel"
                    } ${m.state === "sending" ? "opacity-60" : ""} ${m.state === "failed" ? "opacity-60 ring-2 ring-[#b42318]" : ""}`}
                  >
                    {m.text}
                  </p>
                </div>
                {last && (
                  <p className={`mt-1 mb-3 text-[11px] text-secondary ${agent ? "text-right" : ""}`}>
                    {m.state === "failed" ? (
                      <>
                        Not sent ·{" "}
                        <button type="button" onClick={() => send(m.text, m.clientId!)} className="text-fg underline underline-offset-2">
                          Retry
                        </button>
                      </>
                    ) : m.state === "sending" ? (
                      "Sending…"
                    ) : (
                      <>
                        {agent && m.author && `${m.author.name.split(" ")[0]} · `}
                        {clockTime(m.createdAt)}
                      </>
                    )}
                  </p>
                )}
              </Fragment>
            );
          })}
        </div>

        {error && (
          <div className="px-5 pb-2">
            <ErrorNote>{error}</ErrorNote>
          </div>
        )}
        {device.signedOutAt && (
          <p className="mx-5 mb-2 rounded-2xl bg-panel px-4 py-3 text-[13px] text-secondary">
            This user logged out of this device. The conversation stays here, but new replies won&apos;t reach them.
          </p>
        )}
        {device.blocked && (
          <p className="mx-5 mb-2 rounded-2xl bg-panel px-4 py-3 text-[13px] text-secondary">
            This user is blocked: they can read replies but can&apos;t send messages.{" "}
            <button type="button" onClick={() => setBlocked(false)} className="text-fg underline underline-offset-2">
              Unblock
            </button>
          </p>
        )}
        <form onSubmit={submit} className="px-5 pb-4">
          <div className="flex items-end gap-2 rounded-[24px] border border-[var(--field)] bg-white p-1.5 pl-4 transition-colors focus-within:border-fg/60">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) submit(e);
              }}
              rows={1}
              maxLength={MESSAGE_MAX_LENGTH}
              placeholder="Reply…"
              aria-label="Reply"
              className="field-sizing-content max-h-40 min-h-9 flex-1 resize-none bg-transparent py-2 text-[15px] outline-none placeholder:text-muted"
            />
            <button
              type="submit"
              disabled={!draft.trim()}
              aria-label="Send"
              className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[var(--accent)] text-white transition-colors hover:bg-[var(--accent-hover)] disabled:bg-[var(--accent-disabled)]"
            >
              <ArrowUpIcon width={18} height={18} />
            </button>
          </div>
          <p className="mt-1.5 px-3 text-[12px] text-muted">Enter to send · Shift+Enter for a new line</p>
        </form>
      </section>

      <aside className="hidden w-[280px] shrink-0 overflow-y-auto border-l border-line px-5 py-4 xl:block">
        <DetailsSection title="User">
          <Detail label="Name" value={device.name} />
          <Detail label="Email" value={device.email} />
          <Detail label="User ID" value={device.userId} />
          <Detail
            label="Identity"
            value={
              device.verified
                ? `Verified${device.verifiedAt ? ` ${relativeTime(device.verifiedAt)}` : ""}`
                : device.userId || device.name || device.email
                  ? "Unverified"
                  : "Anonymous"
            }
          />
        </DetailsSection>
        {Object.keys(device.metadata).length > 0 && (
          <DetailsSection title="Custom fields">
            {Object.entries(device.metadata)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([key, value]) => (
                <Detail key={key} label={key} value={value} />
              ))}
          </DetailsSection>
        )}
        <DetailsSection title="Device">
          <Detail label="App" value={app.name} />
          <Detail label="Device" value={device.model} />
          <Detail label="iOS" value={device.osVersion} />
          <Detail label="App version" value={device.appVersion} />
          <Detail label="SDK" value={device.sdkVersion} />
          <Detail label="Language" value={device.locale} />
          <Detail label="Local time" value={localTimeIn(device.timezone)} />
          <Detail label="Time zone" value={device.timezone} />
          <Detail label="First seen" value={relativeTime(device.createdAt)} />
          <Detail label="Last active" value={device.lastSeenAt ? relativeTime(device.lastSeenAt) : null} />
          <Detail
            label="Notifications"
            value={device.push.enabled ? (device.push.environment === "sandbox" ? "On · Sandbox" : "On · Production") : "Off"}
          />
          {device.push.issue && <Detail label="Push issue" value={device.push.issue} />}
        </DetailsSection>
        <div className="flex flex-col items-start gap-2">
          <button
            type="button"
            onClick={() => setBlocked(!device.blocked)}
            className="text-[13px] text-secondary underline-offset-4 hover:text-fg hover:underline"
          >
            {device.blocked ? "Unblock user" : "Block user"}
          </button>
          {isAdmin(me) && (
            <button
              type="button"
              onClick={deleteUserData}
              className="text-[13px] text-[#b42318] underline-offset-4 hover:underline"
            >
              Delete user data
            </button>
          )}
        </div>
      </aside>
    </div>
  );
}
