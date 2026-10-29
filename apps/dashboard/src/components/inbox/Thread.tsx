"use client";

import {
  MESSAGE_MAX_LENGTH,
  PHOTO_LIMITS,
  TYPING_TTL_MS,
  type Attachment,
  type InboxConversation,
  type InboxMessage,
  type InboxThread,
} from "@hshelby/contracts";
import { ArrowLeftIcon, ArrowUpIcon, ImageIcon, StarIcon, TokensIcon } from "@radix-ui/react-icons";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { AppIcon, ErrorNote, Spinner } from "@/components/ui";
import { api, ApiError, apiForm } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import { useBilling } from "@/lib/billing";
import { sendLive, useLive, useLiveConnected } from "@/lib/live";
import { preparePhoto } from "@/lib/photos";
import { clockTime, dayLabel, localTimeIn, relativeTime, sameDay } from "@/lib/time";
import { isAdmin, useMe } from "@/lib/use-me";
import { useVisibleInterval } from "@/lib/use-visible-interval";
import { CardBubble, CardDialog } from "./Cards";
import { IdentityBadge } from "./Identity";
import { deviceLabel, useInbox } from "./InboxContext";
import { MessagePhotos, PhotoViewer, StagedPhotos, type StagedPhoto } from "./Photos";

/** A stored message, or one of ours still on its way (no seq yet). */
type Item = InboxMessage & { state?: "sending" | "failed" };

const GROUP_GAP_MS = 5 * 60_000;

const toolbarButton =
  "flex h-8 items-center gap-1.5 rounded-full bg-panel px-3 text-[13px] text-secondary transition-colors hover:bg-[var(--panel-hover)] hover:text-fg";

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
  const { billing, reload: reloadBilling } = useBilling();
  const [items, setItems] = useState<Item[]>([]);
  const [hasOlder, setHasOlder] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [draft, setDraft] = useState("");
  const [staged, setStaged] = useState<StagedPhoto[]>([]);
  const [viewing, setViewing] = useState<Attachment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [missing, setMissing] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const restoreFromHeight = useRef<number | null>(null);
  const live = useLiveConnected();
  /** Who's typing in this conversation right now: the user, or another teammate. */
  const [typing, setTyping] = useState<{ label: string; until: number } | null>(null);
  const lastTypingSent = useRef(0);
  const [cardDialog, setCardDialog] = useState<"review" | "paywall" | null>(null);

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

  const reloadConversation = () =>
    api<{ conversation: InboxConversation }>(base)
      .then((c) => setConversation(c.conversation))
      .catch(() => {});

  /** Fetches messages after the last seq, then the conversation's fresh counters. */
  function catchUp(always = false) {
    if (!conversation) return;
    api<InboxThread>(`${base}/messages?after=${lastSeq}&limit=100`)
      .then(async (t) => {
        if (t.messages.length > 0) setItems((current) => merge(current, t.messages));
        if (t.messages.length > 0 || always) await reloadConversation();
      })
      .catch(() => {});
  }

  // Live updates do the work; polling is the fallback, and slows right down while the socket is up.
  useVisibleInterval(() => catchUp(), live ? 30_000 : 3000);
  useLive((event) => {
    if (event.type === "ready" || event.type === "resync") return catchUp(true);
    if (event.conversationId !== conversationId) return;
    if (event.type === "message") {
      if (event.sender === "user") setTyping(null);
      catchUp();
    } else if (event.type === "conversation") {
      void reloadConversation();
    } else if (event.type === "action") {
      // a card was tapped: its receipt is on a message we already have, so reload the latest page
      api<InboxThread>(`${base}/messages?limit=50`)
        .then((t) => setItems((current) => merge(current, t.messages)))
        .catch(() => {});
    } else if (event.type === "presence") {
      setConversation((c) =>
        c && { ...c, device: { ...c.device, inChat: event.inChat, lastSeenInChatAt: new Date().toISOString() } },
      );
    } else if (event.type === "typing" && conversation) {
      const who = event.sender === "user" ? deviceLabel(conversation.device) : (event.name ?? "A teammate");
      setTyping({ label: `${who} is typing…`, until: Date.now() + TYPING_TTL_MS });
    }
  });
  useEffect(() => {
    if (!typing) return;
    const id = setTimeout(() => setTyping(null), typing.until - Date.now());
    return () => clearTimeout(id);
  }, [typing]);

  /** Lets the user see a teammate typing; at most every 2 seconds. */
  function notifyTyping() {
    if (Date.now() - lastTypingSent.current < 2000) return;
    lastTypingSent.current = Date.now();
    sendLive({ type: "typing", conversationId });
  }

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

  async function send(text: string, photos: Attachment[], clientId: string = crypto.randomUUID()) {
    const pending: Item = {
      id: `pending-${clientId}`,
      seq: Number.MAX_SAFE_INTEGER,
      sender: "agent",
      source: "dashboard",
      kind: "text",
      text,
      card: null,
      actionClickedAt: null,
      clientId,
      attachments: photos,
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
        body: JSON.stringify({ clientId, text, attachmentIds: photos.map((a) => a.id) }),
      });
      setItems((current) => merge(current, [message]));
      setConversation((c) => c && { ...c, lastSeq: Math.max(c.lastSeq, message.seq), unreadForTeam: 0 });
      refresh();
    } catch (e) {
      setItems((current) => current.map((m) => (m.state && m.clientId === clientId ? { ...m, state: "failed" } : m)));
      // the subscription lapsed since the page loaded: show why replies stopped
      if (e instanceof ApiError && e.code === "subscription_inactive") reloadBilling();
    }
  }

  const ready = staged.flatMap((p) => (p.attachment ? [p.attachment] : []));
  const uploading = staged.some((p) => !p.attachment && !p.error);

  function submit(e?: FormEvent) {
    e?.preventDefault();
    const text = draft.trim();
    if ((!text && ready.length === 0) || uploading) return;
    setDraft("");
    for (const p of staged) URL.revokeObjectURL(p.previewUrl);
    setStaged([]);
    void send(text, ready);
  }

  /** Photos upload as soon as they're picked, so sending is instant. */
  function pickPhotos(files: FileList | null) {
    const picked = Array.from(files ?? []).slice(0, PHOTO_LIMITS.perMessage - staged.length);
    for (const file of picked) {
      const localId = crypto.randomUUID();
      setStaged((current) => [...current, { localId, previewUrl: URL.createObjectURL(file) }]);
      const update = (patch: Partial<StagedPhoto>) =>
        setStaged((current) => current.map((p) => (p.localId === localId ? { ...p, ...patch } : p)));
      preparePhoto(file)
        .then((photo) => {
          const form = new FormData();
          form.set("file", photo);
          return apiForm<{ attachment: Attachment }>(`${base}/attachments`, form);
        })
        .then(({ attachment }) => update({ attachment }))
        .catch((e: unknown) => {
          const message = e instanceof Error ? e.message : "Couldn't upload this photo";
          update({ error: message });
          setError(message);
        });
    }
    if (fileInput.current) fileInput.current.value = "";
  }

  function unstage(localId: string) {
    setStaged((current) => {
      const photo = current.find((p) => p.localId === localId);
      if (photo) URL.revokeObjectURL(photo.previewUrl);
      return current.filter((p) => p.localId !== localId);
    });
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
  // without a subscription, the team replies only in the app's setup conversation
  const unsubscribed = Boolean(billing?.enabled && !billing.active);
  const replyLocked = unsubscribed && !conversation.setup;

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
              {device.inChat && (
                <span className="flex shrink-0 items-center gap-1 rounded-full bg-[#e8f7ee] px-2 py-0.5 text-[11px] text-[#14773a]">
                  <span className="size-1.5 rounded-full bg-[#22a355]" />
                  In chat
                </span>
              )}
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
                {m.attachments.length > 0 && (
                  <div className={`mt-1 flex ${agent ? "justify-end" : "justify-start"} ${m.state ? "opacity-60" : ""}`}>
                    <MessagePhotos attachments={m.attachments} align={agent ? "end" : "start"} onOpen={setViewing} />
                  </div>
                )}
                {m.card ? (
                  <div className="mt-1 flex justify-end">
                    <CardBubble message={m} who={deviceLabel(device)} pending={Boolean(m.state)} />
                  </div>
                ) : m.text && (
                  <div className={`mt-1 flex ${agent ? "justify-end" : "justify-start"}`}>
                    <p
                      className={`max-w-[75%] whitespace-pre-wrap break-words rounded-[20px] px-4 py-2.5 text-[15px] leading-[1.4] ${
                        agent ? "bg-[var(--accent)] text-white" : "bg-panel"
                      } ${m.state === "sending" ? "opacity-60" : ""} ${m.state === "failed" ? "opacity-60 ring-2 ring-[#b42318]" : ""}`}
                    >
                      {m.text}
                    </p>
                  </div>
                )}
                {last && (
                  <p className={`mt-1 mb-3 text-[11px] text-secondary ${agent ? "text-right" : ""}`}>
                    {m.state === "failed" ? (
                      <>
                        Not sent ·{" "}
                        <button type="button" onClick={() => send(m.text, m.attachments, m.clientId!)} className="text-fg underline underline-offset-2">
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

        <p aria-live="polite" className="h-5 px-6 text-[12px] text-secondary">
          {typing?.label}
        </p>
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
        {replyLocked ? (
          <div className="px-5 pb-4">
            <div className="rounded-[24px] bg-panel px-5 py-4 text-[14px]">
              <p>Subscribe to reply. {deviceLabel(device)} can still write in, and nothing is lost.</p>
              <Link href="/billing" className="mt-2 inline-block underline underline-offset-2">
                Subscribe
              </Link>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} className="px-5 pb-4">
            {unsubscribed && (
              <p className="mb-2 px-3 text-[12px] text-muted">This is your app&apos;s setup conversation: you can reply here before subscribing.</p>
            )}
            <div className="mb-2 flex gap-2">
              <button type="button" onClick={() => setCardDialog("review")} className={toolbarButton}>
                <StarIcon /> Ask for review
              </button>
              <button type="button" onClick={() => setCardDialog("paywall")} className={toolbarButton}>
                <TokensIcon /> Send offer
              </button>
            </div>
            <StagedPhotos photos={staged} onRemove={unstage} />
            <div className="flex items-end gap-2 rounded-[24px] border border-[var(--field)] bg-white p-1.5 transition-colors focus-within:border-fg/60">
              <input
                ref={fileInput}
                type="file"
                accept="image/*"
                multiple
                hidden
                onChange={(e) => pickPhotos(e.target.files)}
              />
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                disabled={staged.length >= PHOTO_LIMITS.perMessage}
                aria-label="Attach photos"
                className="flex size-9 shrink-0 items-center justify-center rounded-full text-secondary transition-colors hover:bg-panel hover:text-fg disabled:opacity-40"
              >
                <ImageIcon width={18} height={18} />
              </button>
              <textarea
                value={draft}
                onChange={(e) => {
                  setDraft(e.target.value);
                  if (e.target.value.trim()) notifyTyping();
                }}
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
                disabled={(!draft.trim() && ready.length === 0) || uploading}
                aria-label="Send"
                className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[var(--accent)] text-white transition-colors hover:bg-[var(--accent-hover)] disabled:bg-[var(--accent-disabled)]"
              >
                <ArrowUpIcon width={18} height={18} />
              </button>
            </div>
            <p className="mt-1.5 px-3 text-[12px] text-muted">Enter to send · Shift+Enter for a new line</p>
          </form>
        )}
      </section>

      {viewing && <PhotoViewer attachment={viewing} onClose={() => setViewing(null)} />}
      {cardDialog && (
        <CardDialog
          kind={cardDialog}
          conversation={conversation}
          onClose={() => setCardDialog(null)}
          onSent={(message) => {
            stickToBottom.current = true;
            setItems((current) => merge(current, [message]));
            setConversation((c) => c && { ...c, lastSeq: Math.max(c.lastSeq, message.seq), unreadForTeam: 0 });
            void reloadConversation();
            refresh();
          }}
        />
      )}
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
            label="Chat open"
            value={device.inChat ? "Now" : device.lastSeenInChatAt ? relativeTime(device.lastSeenInChatAt) : null}
          />
          <Detail
            label="Notifications"
            value={device.push.enabled ? (device.push.environment === "sandbox" ? "On · Sandbox" : "On · Production") : "Off"}
          />
          {device.push.issue && <Detail label="Push issue" value={device.push.issue} />}
        </DetailsSection>
        <DetailsSection title="Offers and reviews">
          <Detail
            label="Paywalls"
            value={device.paywallsReportedAt ? `${device.paywalls.length} available` : "Not reported"}
          />
          <Detail label="Review asked" value={device.reviewAskedAt ? relativeTime(device.reviewAskedAt) : "Never"} />
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
