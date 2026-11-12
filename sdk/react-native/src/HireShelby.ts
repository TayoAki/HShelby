import { native } from "./native";
import type { AIReplies, HireShelbyEvent, Options, Paywall, Subscription, UserLabels } from "./types";

/*
 * Hire Shelby for React Native: the iOS SDK's native chat, driven from JavaScript. Everything here is safe to
 * call anywhere: on Android, on the web and in Expo Go (no native module) calls do nothing, promises resolve with
 * empty values, and `HireShelby.isSupported` is false.
 */

const APP_ID = /^app_[0-9A-Za-z]{22}$/;
const noop: Subscription = { remove() {} };
let warned = false;
let chatOpen = false;
let configured = false;

declare const __DEV__: boolean | undefined;
const isDev = typeof __DEV__ !== "undefined" && __DEV__;

function devWarn(message: string) {
  if (isDev) console.warn(`[HireShelby] ${message}`);
}

/** The native module, or null with a one-time warning explaining why the call did nothing. */
function sdk() {
  if (!native && !warned) {
    warned = true;
    devWarn(
      "The native module isn't in this build, so calls do nothing. It runs on iOS in a development or release build (not Expo Go); rebuild after installing.",
    );
  }
  return native;
}

/** Fire-and-forget calls: a native error is reported in development, never thrown at the caller. */
function call(body: () => Promise<unknown> | undefined) {
  void body()?.catch((error: unknown) => devWarn(String(error)));
}

if (native) {
  native.addListener("onEvent", (event) => {
    if (event.type === "chatOpened") chatOpen = true;
    if (event.type === "chatClosed") chatOpen = false;
  });
}

/** The notification's own data: accepts an expo-notifications Notification or response, or a raw payload. */
function payloadOf(input: unknown): Record<string, unknown> | null {
  if (!input || typeof input !== "object") return null;
  const value = input as Record<string, any>;
  if (value.notification) return payloadOf(value.notification); // a NotificationResponse
  const trigger = value.request?.trigger;
  if (trigger && typeof trigger === "object") return (trigger.payload as Record<string, unknown>) ?? null; // a Notification
  return value;
}

export const HireShelby = {
  /** True on iOS builds that include the native module. */
  get isSupported(): boolean {
    return native !== null;
  },

  /** The iOS SDK's version, or null where it isn't available. */
  get version(): string | null {
    return native?.sdkVersion ?? null;
  },

  /**
   * Sets the SDK up. Call once at startup, outside any component (for example in your root file), with the App
   * ID from the dashboard. Calls made before it are kept and applied once it runs.
   */
  configure(appId: string, options: Options = {}): void {
    if (!APP_ID.test(appId.trim())) devWarn(`"${appId}" doesn't look like an App ID (app_ followed by 22 letters and digits); copy it from the dashboard.`);
    configured = true;
    call(() => sdk()?.configure(appId.trim(), options));
  },

  /** Whether `configure` was called. */
  get isConfigured(): boolean {
    return configured;
  },

  /**
   * Tells the team who the user is: after restoring a session and after sign-in, with what your app knows.
   * Pass `{ token }` (an HS256 JWT from your server, signed with the app's identity secret) to verify them.
   */
  identify(user: UserLabels | { token: string }): void {
    if ("token" in user) {
      call(() => sdk()?.identifyWithToken(user.token));
    } else {
      call(() => sdk()?.identify(user.userId ?? null, user.name ?? null, user.email ?? null));
    }
  },

  /** Where a signed-in session really ends (sign-out, account switch), before the next user's identify. Never for guests. */
  logout(): void {
    call(() => sdk()?.logout());
  },

  /** Deletes the user's support data on the server and the device. Await it in your account-deletion flow. */
  async deleteData(): Promise<void> {
    await sdk()?.deleteData();
  },

  /**
   * Details the team sees next to the chat (plan, sign-up date…): up to 20 string values, each call replacing the
   * last. Never health data, passwords, precise location or payment details; names and emails go through identify.
   */
  setMetadata(metadata: Record<string, string>): void {
    call(() => sdk()?.setMetadata(metadata));
  },

  /** Opens the chat as a sheet over your app. */
  presentChat(): void {
    call(() => sdk()?.presentChat());
  },

  dismissChat(): void {
    call(() => sdk()?.dismissChat());
  },

  /** The chat is on screen. */
  isChatOpen(): boolean {
    return chatOpen;
  },

  /** Unread team messages, fetched now. `useUnreadCount()` keeps a badge up to date. */
  async getUnreadCount(): Promise<number> {
    return (await sdk()?.getUnreadCount()) ?? 0;
  },

  /** Called with the unread count now and after every change. */
  addUnreadCountListener(listener: (count: number) => void): Subscription {
    return native?.addListener("onUnreadCountChange", ({ count }) => listener(count)) ?? noop;
  },

  /** SDK events: the chat opened or closed, a message was sent, card taps, data deleted, identity token refused. */
  addEventListener(listener: (event: HireShelbyEvent) => void): Subscription {
    return native?.addListener("onEvent", listener) ?? noop;
  },

  /**
   * Shows one of your paywalls when the user taps an offer card, with the ID you reported in `reportPaywalls`.
   * The chat closes first (see `dismissesChatForPaywall`).
   */
  setPaywallHandler(handler: (paywallId: string) => void): Subscription {
    return native?.addListener("onPaywall", ({ paywallId }) => handler(paywallId)) ?? noop;
  },

  // Push

  /**
   * Forwards the APNs device token yourself. Not needed by default: the SDK picks the token up whenever the app has
   * notification permission (`automaticPushToken`). The SDK never asks for permission.
   */
  setPushToken(token: string, environment: "automatic" | "sandbox" | "production" = "automatic"): void {
    call(() => sdk()?.setPushToken(token, environment));
  },

  /** Stops notifications to this device. */
  clearPushToken(): void {
    call(() => sdk()?.clearPushToken());
  },

  /**
   * Whether the person opted in, in your app, to promotional notifications (App Review guideline 4.5.4). Offers
   * and automations' messages reach the lock screen only when they did; they always appear in the chat, and the
   * team's replies always push. Off until you report it.
   */
  setPromotionalPushAllowed(allowed: boolean): void {
    call(() => sdk()?.setPromotionalPushAllowed(allowed));
  },

  /** Whether a notification is Hire Shelby's: an expo-notifications Notification or response, or a raw payload. */
  isHireShelbyNotification(notification: unknown): boolean {
    const payload = payloadOf(notification);
    return !!payload && typeof payload.hireshelby === "object" && payload.hireshelby !== null;
  },

  /** For a foreground notification handler: false while the chat is open (the message shows there). */
  shouldShowNotification(notification: unknown): boolean {
    return !(HireShelby.isHireShelbyNotification(notification) && chatOpen);
  },

  /**
   * Handles a notification the user tapped: for Hire Shelby's, refreshes the chat and opens it. Pass the
   * expo-notifications response (or the payload). Resolves false for your own notifications.
   */
  async handleNotification(notification: unknown, options: { openChat?: boolean } = {}): Promise<boolean> {
    const payload = payloadOf(notification);
    if (!payload || !HireShelby.isHireShelbyNotification(payload)) return false;
    return (await sdk()?.handleNotification(payload, options.openChat ?? true)) ?? false;
  },

  // Paywalls, StoreKit, automations

  /** The paywalls your app can show right now (replacing the earlier list), so the team can send offers for them. */
  reportPaywalls(paywalls: Paywall[]): void {
    call(() => sdk()?.reportPaywalls(paywalls));
  },

  /** What StoreKit (or your purchases SDK) says: whether the person pays, and their original transaction IDs. */
  reportStoreKit(state: { paying?: boolean | null; originalTransactionIds?: string[] }): void {
    call(() => sdk()?.reportStoreKit(state.paying ?? null, state.originalTransactionIds ?? []));
  },

  /** Reads StoreKit 2's current entitlements on the device and reports them. */
  async reportStoreKitEntitlements(): Promise<void> {
    await sdk()?.reportStoreKitEntitlements();
  },

  /**
   * Tracks an event for automations (`paywall_declined`, `onboarding_completed`…); only events an enabled
   * automation listens for leave the device. With `opensChat`, the chat opens when an automation answers at once.
   */
  track(event: string, options: { opensChat?: boolean } = {}): void {
    call(() => sdk()?.track(event, options.opensChat ?? false));
  },

  // AI replies

  /** AI replies in the chat, as of its last load. The chat asks the person itself. */
  async getAIReplies(): Promise<AIReplies> {
    const ai = await sdk()?.getAIReplies();
    if (!ai) return { isEnabled: false, consent: null, processors: [], isAllowed: false, needsConsent: false };
    return { ...ai, consent: ai.consent === "granted" || ai.consent === "declined" ? ai.consent : null };
  },

  /**
   * Allows AI replies for this person, or turns them off: for a switch in your app's own settings (the chat
   * asks, and has the same switch in its menu). Only the person makes this choice; never call it for them.
   */
  async setAIRepliesAllowed(allowed: boolean): Promise<void> {
    await sdk()?.setAIRepliesAllowed(allowed);
  },
};

export type HireShelbyAPI = typeof HireShelby;
