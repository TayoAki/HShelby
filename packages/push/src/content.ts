import { brand } from "@hshelby/contracts";

export type PushContentSettings = {
  titleTemplate: string;
  bodyTemplate: string;
  senderName: string | null;
  showPreview: boolean;
  sound: boolean;
};

const TITLE_MAX = 100;
const BODY_MAX = 500;

/** Cuts to `max` characters (code points, so emoji aren't split) with an ellipsis. */
function clip(text: string, max: number) {
  const chars = Array.from(text.trim());
  return chars.length <= max ? chars.join("") : `${chars.slice(0, max - 1).join("").trimEnd()}…`;
}

/** {message}, {agent} and {app}, filled in one pass so placeholders inside the message stay literal. */
export function fillTemplate(template: string, values: { message: string; agent: string; app: string }) {
  return template.replace(/\{(message|agent|app)\}/g, (_, key: keyof typeof values) => values[key]);
}

/**
 * The APNs payload for a teammate's reply. `badge` is the conversation's unread count for the user, or
 * null when the host app owns its badge.
 */
export function buildPushPayload(
  settings: PushContentSettings,
  context: {
    appName: string;
    authorName: string | null;
    message: string;
    conversationId: string | null;
    messageId?: string;
    badge: number | null;
  },
) {
  const values = {
    message: settings.showPreview ? context.message.replace(/\s+/g, " ") : "New message",
    agent: settings.senderName ?? context.authorName?.split(" ")[0] ?? "Support",
    app: context.appName,
  };
  return {
    aps: {
      alert: {
        title: clip(fillTemplate(settings.titleTemplate, values), TITLE_MAX),
        body: clip(fillTemplate(settings.bodyTemplate, values), BODY_MAX),
      },
      ...(settings.sound && { sound: "default" }),
      ...(context.badge !== null && { badge: context.badge }),
      ...(context.conversationId && { "thread-id": context.conversationId }),
    },
    // the SDK opens this conversation when the notification is tapped
    [brand.name]: {
      ...(context.conversationId && { conversationId: context.conversationId }),
      ...(context.messageId && { messageId: context.messageId }),
    },
  };
}
