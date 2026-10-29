import { messagePreview, type MessageKind, type StoredCard } from "@hshelby/contracts";

/** Telegram's limit is 4,096 characters after entities are parsed; long messages are cut well before it. */
const TEXT_MAX = 3500;
const TOPIC_NAME_MAX = 128;

export const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Cuts to `max` characters (code points, so emoji aren't split) with an ellipsis. */
export function clip(text: string, max: number) {
  const chars = Array.from(text.trim());
  return chars.length <= max ? chars.join("") : `${chars.slice(0, max - 1).join("").trimEnd()}…`;
}

type Body = { text: string; kind: MessageKind; card: StoredCard | null; photos: number };

function body(m: Body) {
  const photos = m.photos === 0 ? "" : m.photos === 1 ? "📷 Photo" : `📷 ${m.photos} photos`;
  const text = m.text || m.kind !== "text" ? messagePreview(m) : "";
  return [photos, text && escapeHtml(clip(text, TEXT_MAX))].filter(Boolean).join("\n");
}

/** A customer's message: "**App · User** ✓" (the check for verified users), then the text. Photos aren't forwarded. */
export function notificationHtml(m: Body & { appName: string; userLabel: string; verified: boolean }) {
  const header = `<b>${escapeHtml(`${m.appName} · ${m.userLabel}`)}</b>${m.verified ? " ✓" : ""}`;
  return `${header}\n${body(m)}`;
}

/** A reply sent from the inbox, an automation or the AI, posted silently under the customer's latest notification. */
export function mirrorHtml(m: Body & { senderName: string }) {
  return `<b>${escapeHtml(m.senderName)}</b>: ${body(m)}`;
}

/** "App · User", the forum topic for one customer. */
export const topicName = (appName: string, userLabel: string) => clip(`${appName} · ${userLabel}`, TOPIC_NAME_MAX);
