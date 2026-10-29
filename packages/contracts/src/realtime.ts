import { z } from "zod";

/*
 * Live updates over WebSocket: `/v1/live` for the SDK (access token in the Authorization header) and
 * `/api/live` for the dashboard (session cookie). Events say what changed, not the data: clients fetch with
 * `after=seq` or reload the conversation. Every connection starts with `ready`, and `resync` means events
 * may have been missed; either way, catch up once.
 */

/** The SDK sends a heartbeat this often while the chat is on screen. */
export const LIVE_HEARTBEAT_MS = 15_000;
/** A device counts as "In chat" this long after its last heartbeat (or until its socket closes). */
export const IN_CHAT_WINDOW_MS = 45_000;
/** A typing indicator shows this long unless it's refreshed. */
export const TYPING_TTL_MS = 5_000;

/** Whether a device is in the chat right now: a live socket that sent a heartbeat recently. */
export const isInChat = (device: { chatOpen: boolean; lastSeenInChatAt: Date | null }, now = Date.now()) =>
  device.chatOpen && device.lastSeenInChatAt !== null && now - device.lastSeenInChatAt.getTime() < IN_CHAT_WINDOW_MS;

/** Server → SDK. `message` covers both sides' messages in the device's conversation. */
export type SdkLiveEvent =
  | { type: "ready" }
  | { type: "message"; seq: number }
  | { type: "read"; seq: number }
  | { type: "typing"; name: string | null }
  | { type: "resync" };

/** Server → dashboard, for every conversation of the workspace. */
export type TeamLiveEvent =
  | { type: "ready" }
  | { type: "message"; conversationId: string; seq: number; sender: "user" | "agent" }
  /** Status, read state or the device changed: reload the conversation. */
  | { type: "conversation"; conversationId: string }
  | { type: "typing"; conversationId: string; sender: "user" | "agent"; name: string | null; userId: string | null }
  | { type: "presence"; conversationId: string; inChat: boolean }
  /** The user tapped a card's button for the first time: reload that message. */
  | { type: "action"; conversationId: string; messageId: string }
  | { type: "resync" };

/** SDK → server: the user is typing, or the chat is still on screen. */
export const SdkLiveCommand = z.discriminatedUnion("type", [z.object({ type: z.literal("typing") }), z.object({ type: z.literal("heartbeat") })]);
export type SdkLiveCommand = z.infer<typeof SdkLiveCommand>;

/** Dashboard → server: a teammate is typing a reply. */
export const TeamLiveCommand = z.discriminatedUnion("type", [z.object({ type: z.literal("typing"), conversationId: z.uuid() })]);
export type TeamLiveCommand = z.infer<typeof TeamLiveCommand>;
