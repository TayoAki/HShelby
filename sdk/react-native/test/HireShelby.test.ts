import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** A stand-in for the native module: records calls, and lets tests emit its events. */
function fakeNative() {
  const listeners = new Map<string, Set<(event: any) => void>>();
  const calls: [string, unknown[]][] = [];
  const record =
    (name: string, result?: unknown) =>
    (...args: unknown[]) => {
      calls.push([name, args]);
      return Promise.resolve(result);
    };
  return {
    calls,
    emit(name: string, event: unknown) {
      for (const listener of listeners.get(name) ?? []) listener(event);
    },
    module: {
      sdkVersion: "0.1.0",
      addListener(name: string, listener: (event: any) => void) {
        if (!listeners.has(name)) listeners.set(name, new Set());
        listeners.get(name)!.add(listener);
        return { remove: () => listeners.get(name)!.delete(listener) };
      },
      configure: record("configure"),
      identify: record("identify"),
      identifyWithToken: record("identifyWithToken"),
      logout: record("logout"),
      deleteData: record("deleteData"),
      setMetadata: record("setMetadata"),
      presentChat: record("presentChat"),
      dismissChat: record("dismissChat"),
      getUnreadCount: record("getUnreadCount", 3),
      setPushToken: record("setPushToken"),
      clearPushToken: record("clearPushToken"),
      setPromotionalPushAllowed: record("setPromotionalPushAllowed"),
      handleNotification: record("handleNotification", true),
      reportPaywalls: record("reportPaywalls"),
      reportStoreKit: record("reportStoreKit"),
      reportStoreKitEntitlements: record("reportStoreKitEntitlements"),
      track: record("track"),
      getAIReplies: record("getAIReplies", { isEnabled: true, consent: null, processors: ["OpenRouter", "Anthropic"], isAllowed: false, needsConsent: true }),
      setAIRepliesAllowed: record("setAIRepliesAllowed"),
    },
  };
}

let native: ReturnType<typeof fakeNative> | null = null;
vi.mock("expo-modules-core", () => ({ requireOptionalNativeModule: () => native?.module ?? null }));

async function load() {
  vi.resetModules();
  return (await import("../src/HireShelby")).HireShelby;
}

const APP_ID = "app_0123456789abcdefABCDEF";
const pushPayload = { aps: { alert: { title: "LockdList", body: "Ada: Hi" } }, hireshelby: { conversationId: "c1", messageId: "m1" } };

describe("on iOS", () => {
  beforeEach(() => {
    native = fakeNative();
  });

  it("hands each call to the native module with its arguments", async () => {
    const HireShelby = await load();
    expect(HireShelby.isSupported).toBe(true);
    expect(HireShelby.version).toBe("0.1.0");
    HireShelby.configure(` ${APP_ID} `, { theme: { accentColor: "#FF5A1F" }, reviewPrompt: "inApp" });
    HireShelby.identify({ userId: "u1", name: "Alex" });
    HireShelby.identify({ token: "jwt" });
    HireShelby.setMetadata({ plan: "pro" });
    HireShelby.setPushToken("ab".repeat(32));
    HireShelby.setPromotionalPushAllowed(true);
    HireShelby.reportPaywalls([{ id: "pro_yearly", title: "Pro yearly", source: "revenuecat" }]);
    HireShelby.reportStoreKit({ paying: true });
    HireShelby.track("paywall_declined", { opensChat: true });
    HireShelby.presentChat();
    HireShelby.logout();
    await HireShelby.deleteData();
    expect(native!.calls).toEqual([
      ["configure", [APP_ID, { theme: { accentColor: "#FF5A1F" }, reviewPrompt: "inApp" }]],
      ["identify", ["u1", "Alex", null]],
      ["identifyWithToken", ["jwt"]],
      ["setMetadata", [{ plan: "pro" }]],
      ["setPushToken", ["ab".repeat(32), "automatic"]],
      ["setPromotionalPushAllowed", [true]],
      ["reportPaywalls", [[{ id: "pro_yearly", title: "Pro yearly", source: "revenuecat" }]]],
      ["reportStoreKit", [true, []]],
      ["track", ["paywall_declined", true]],
      ["presentChat", []],
      ["logout", []],
      ["deleteData", []],
    ]);
  });

  it("forwards events, unread counts and paywall taps, and tracks whether the chat is open", async () => {
    const HireShelby = await load();
    const counts: number[] = [];
    const paywalls: string[] = [];
    const events: string[] = [];
    const unread = HireShelby.addUnreadCountListener((n) => counts.push(n));
    HireShelby.setPaywallHandler((id) => paywalls.push(id));
    HireShelby.addEventListener((e) => events.push(e.type));
    native!.emit("onUnreadCountChange", { count: 2 });
    native!.emit("onPaywall", { paywallId: "pro_yearly" });
    native!.emit("onEvent", { type: "chatOpened" });
    expect(HireShelby.isChatOpen()).toBe(true);
    native!.emit("onEvent", { type: "chatClosed" });
    expect(HireShelby.isChatOpen()).toBe(false);
    unread.remove();
    native!.emit("onUnreadCountChange", { count: 5 });
    expect(counts).toEqual([2]);
    expect(paywalls).toEqual(["pro_yearly"]);
    expect(events).toEqual(["chatOpened", "chatClosed"]);
    expect(await HireShelby.getUnreadCount()).toBe(3);
  });

  it("recognises its notifications in expo-notifications' shapes and hands only those over", async () => {
    const HireShelby = await load();
    const notification = { request: { identifier: "x", content: {}, trigger: { type: "push", payload: pushPayload } } };
    const response = { actionIdentifier: "expo.modules.notifications.actions.DEFAULT", notification };
    expect(HireShelby.isHireShelbyNotification(notification)).toBe(true);
    expect(HireShelby.isHireShelbyNotification(response)).toBe(true);
    expect(HireShelby.isHireShelbyNotification(pushPayload)).toBe(true);
    expect(HireShelby.isHireShelbyNotification({ request: { trigger: { type: "push", payload: { aps: {} } } } })).toBe(false);
    expect(HireShelby.isHireShelbyNotification(null)).toBe(false);

    expect(await HireShelby.handleNotification(response)).toBe(true);
    expect(native!.calls.at(-1)).toEqual(["handleNotification", [pushPayload, true]]);
    expect(await HireShelby.handleNotification({ aps: {} })).toBe(false);
    expect(native!.calls).toHaveLength(1);

    // hidden while the chat shows the message
    expect(HireShelby.shouldShowNotification(notification)).toBe(true);
    native!.emit("onEvent", { type: "chatOpened" });
    expect(HireShelby.shouldShowNotification(notification)).toBe(false);
    expect(HireShelby.shouldShowNotification({ aps: {} })).toBe(true);
  });

  it("reads and sets the person's AI replies choice", async () => {
    const HireShelby = await load();
    expect(await HireShelby.getAIReplies()).toEqual({ isEnabled: true, consent: null, processors: ["OpenRouter", "Anthropic"], isAllowed: false, needsConsent: true });
    await HireShelby.setAIRepliesAllowed(false);
    expect(native!.calls.at(-1)).toEqual(["setAIRepliesAllowed", [false]]);
  });
});

describe("without the native module (Android, web, Expo Go)", () => {
  beforeEach(() => {
    native = null;
    vi.spyOn(console, "warn").mockImplementation(() => {});
    (globalThis as any).__DEV__ = true;
  });
  afterEach(() => {
    vi.restoreAllMocks();
    delete (globalThis as any).__DEV__;
  });

  it("does nothing, resolves empty values and warns once in development", async () => {
    const HireShelby = await load();
    expect(HireShelby.isSupported).toBe(false);
    expect(HireShelby.version).toBeNull();
    HireShelby.configure(APP_ID);
    HireShelby.presentChat();
    HireShelby.identify({ userId: "u1" });
    await expect(HireShelby.deleteData()).resolves.toBeUndefined();
    expect(await HireShelby.getUnreadCount()).toBe(0);
    expect(await HireShelby.handleNotification(pushPayload)).toBe(false);
    expect((await HireShelby.getAIReplies()).isEnabled).toBe(false);
    HireShelby.addUnreadCountListener(() => {}).remove();
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it("warns about an App ID that isn't one", async () => {
    const HireShelby = await load();
    HireShelby.configure("my-app");
    expect(vi.mocked(console.warn).mock.calls[0]![0]).toContain("doesn't look like an App ID");
  });
});
