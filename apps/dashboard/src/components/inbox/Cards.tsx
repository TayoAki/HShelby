"use client";

import {
  CARD_TEXT_MAX,
  isPaywallAvailable,
  ReviewScenario,
  type CardSettings,
  type InboxConversation,
  type InboxMessage,
} from "@hshelby/contracts";
import { Cross2Icon, StarFilledIcon } from "@radix-ui/react-icons";
import { useEffect, useState, type FormEvent } from "react";
import { ErrorNote } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { relativeTime } from "@/lib/time";

const DEFAULT_LABEL = { review: "Rate on the App Store", paywall: "View offer" } as const;

const SCENARIO_LABEL: Record<ReviewScenario, string> = {
  general: "General",
  after_helping: "After helping",
  after_feedback: "After feedback",
};

/** A review or offer message in the thread: its text, the button the user sees, and whether they tapped it. */
export function CardBubble({ message, who, pending }: { message: InboxMessage; who: string; pending: boolean }) {
  const card = message.card!;
  // without a custom label, the app shows its default in the user's language
  const label = card.buttonLabel ?? DEFAULT_LABEL[card.type];
  const receipt =
    card.type === "review"
      ? `${who} tapped to leave you a review on the App Store`
      : `${who} opened the ${card.paywallTitle} paywall`;
  return (
    <div className={`flex max-w-[75%] flex-col items-end gap-1 ${pending ? "opacity-60" : ""}`}>
      <div className="w-72 max-w-full overflow-hidden rounded-[20px] bg-[var(--accent)] text-white">
        <p className="px-4 pt-2.5 text-[11px] tracking-wide text-white/75 uppercase">
          {card.type === "review" ? "Review request" : `Offer · ${card.paywallTitle}`}
        </p>
        {message.text && <p className="px-4 pt-1 text-[15px] leading-[1.4] whitespace-pre-wrap break-words">{message.text}</p>}
        <div className="m-2 mt-2.5 flex items-center justify-center gap-1.5 rounded-[14px] bg-white/20 py-2 text-[14px]">
          {card.type === "review" && <StarFilledIcon />}
          {card.type === "review" && !card.url ? "No App Store ID: shown without a button" : label}
        </div>
      </div>
      {message.actionClickedAt && (
        <p className="text-[11px] text-[#14773a]">
          {receipt} · {relativeTime(message.actionClickedAt)}
        </p>
      )}
    </div>
  );
}

type CardKind = "review" | "paywall";

/**
 * "Ask for review" and "Send offer". An offer lists only the paywalls the user's app last reported; if the last
 * card of the kind got no reply, the teammate types "send review" or "send offer" to send another.
 */
export function CardDialog({
  kind,
  conversation,
  onClose,
  onSent,
}: {
  kind: CardKind;
  conversation: InboxConversation;
  onClose: () => void;
  onSent: (message: InboxMessage) => void;
}) {
  const { device, app } = conversation;
  const [settings, setSettings] = useState<CardSettings | null>(null);
  const [scenario, setScenario] = useState<ReviewScenario>("general");
  const paywalls = device.paywalls.filter((p) => isPaywallAvailable(device.paywalls, p.id));
  const [paywallId, setPaywallId] = useState(paywalls[0]?.id ?? "");
  const [text, setText] = useState("");
  const [buttonLabel, setButtonLabel] = useState("");
  const [clientId] = useState(() => crypto.randomUUID());
  const [confirming, setConfirming] = useState<string | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const phrase = kind === "review" ? "send review" : "send offer";

  useEffect(() => {
    api<CardSettings>(`/apps/${app.id}/cards/settings`)
      .then((s) => {
        setSettings(s);
        if (kind === "review") setText(s.reviewTemplates.general.replaceAll("{app}", app.name));
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Couldn't load the card settings"));
  }, [app.id, app.name, kind]);

  function pickScenario(next: ReviewScenario) {
    setScenario(next);
    if (settings) setText(settings.reviewTemplates[next].replaceAll("{app}", app.name));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (confirming && confirmText.trim().toLowerCase() !== phrase) return;
    setBusy(true);
    setError(null);
    const body =
      kind === "review"
        ? { kind, clientId, text, scenario, buttonLabel: buttonLabel || null, confirmRepeat: Boolean(confirming) }
        : { kind, clientId, paywallId, text, buttonLabel: buttonLabel || null, confirmRepeat: Boolean(confirming) };
    try {
      const { message } = await api<{ message: InboxMessage }>(`/conversations/${conversation.id}/cards`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      onSent(message);
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.code === "card_repeat_unconfirmed") setConfirming(err.message);
      else setError(err instanceof Error ? err.message : "Couldn't send the card");
    } finally {
      setBusy(false);
    }
  }

  const labels = kind === "review" ? settings?.reviewButtonLabels : settings?.offerButtonLabels;
  const noAppStoreId = kind === "review" && settings && !settings.appStoreId;
  const nothingToOffer = kind === "paywall" && paywalls.length === 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md space-y-4 rounded-[28px] bg-white p-6 text-[14px] shadow-xl"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-[19px] tracking-[-.02em]">{kind === "review" ? "Ask for a review" : "Send an offer"}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-full p-1.5 text-secondary hover:bg-panel">
            <Cross2Icon />
          </button>
        </div>

        {noAppStoreId && (
          <p className="rounded-2xl bg-panel px-4 py-3 text-secondary">
            Add {app.name}&apos;s App Store ID in its settings first, so the button knows where to go.
          </p>
        )}
        {nothingToOffer && (
          <p className="rounded-2xl bg-panel px-4 py-3 text-secondary">
            This user&apos;s app hasn&apos;t reported any paywalls it can show. Offers list only what the app reports.
          </p>
        )}

        {kind === "review" && (
          <label className="block">
            <span className="mb-1.5 block text-[13px] text-secondary">Template</span>
            <select
              value={scenario}
              onChange={(e) => pickScenario(e.target.value as ReviewScenario)}
              className="h-10 w-full rounded-xl border border-[var(--field)] bg-white px-3"
            >
              {ReviewScenario.options.map((s) => (
                <option key={s} value={s}>
                  {SCENARIO_LABEL[s]}
                </option>
              ))}
            </select>
          </label>
        )}
        {kind === "paywall" && paywalls.length > 0 && (
          <fieldset>
            <legend className="mb-1.5 text-[13px] text-secondary">
              Paywall · reported {device.paywallsReportedAt ? relativeTime(device.paywallsReportedAt) : "never"}
            </legend>
            <div className="space-y-1">
              {paywalls.map((p) => (
                <label key={p.id} className="flex items-center gap-2 rounded-xl px-2 py-1.5 hover:bg-panel">
                  <input type="radio" name="paywall" checked={paywallId === p.id} onChange={() => setPaywallId(p.id)} className="accent-[var(--accent)]" />
                  <span className="flex-1">{p.title}</span>
                  <span className="font-mono text-[12px] text-secondary">{p.id}</span>
                </label>
              ))}
            </div>
          </fieldset>
        )}

        <label className="block">
          <span className="mb-1.5 block text-[13px] text-secondary">Message (optional)</span>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={CARD_TEXT_MAX}
            rows={3}
            className="w-full resize-none rounded-xl border border-[var(--field)] px-3 py-2 outline-none focus:border-fg/60"
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-[13px] text-secondary">Button</span>
          <select
            value={buttonLabel}
            onChange={(e) => setButtonLabel(e.target.value)}
            className="h-10 w-full rounded-xl border border-[var(--field)] bg-white px-3"
          >
            <option value="">{DEFAULT_LABEL[kind]} (translated)</option>
            {labels?.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </label>

        {confirming && (
          <label className="block rounded-2xl bg-[#fff8e6] px-4 py-3">
            <span className="block">
              {confirming} Type <strong>{phrase}</strong> to send it anyway.
            </span>
            <input
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              autoFocus
              className="mt-2 h-10 w-full rounded-xl border border-[var(--field)] bg-white px-3 outline-none"
            />
          </label>
        )}
        {error && <ErrorNote>{error}</ErrorNote>}

        <button
          type="submit"
          disabled={
            busy || Boolean(noAppStoreId) || nothingToOffer || !settings || (confirming !== null && confirmText.trim().toLowerCase() !== phrase)
          }
          className="h-11 w-full rounded-full bg-[var(--accent)] text-white transition-colors hover:bg-[var(--accent-hover)] disabled:bg-[var(--accent-disabled)]"
        >
          {busy ? "Sending…" : kind === "review" ? "Send review request" : "Send offer"}
        </button>
      </form>
    </div>
  );
}
