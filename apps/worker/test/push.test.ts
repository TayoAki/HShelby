import { randomUUID } from "node:crypto";
import { deliverMessagePush, PushRetryError } from "@hshelby/push";
import { generateP8 } from "@hshelby/push/testing";
import { afterAll, describe, expect, it } from "vitest";
import { pushFixture } from "./push-fixture";

const { db, apns, keyring, sandbox, production, scenario, close } = await pushFixture();
const deps = { db, apns, keyring };
afterAll(close);

const once = { lastAttempt: false };

describe("push.send", () => {
  it("delivers a reply to the device's environment with the badge and conversation", async () => {
    const s = await scenario({ unread: 3, device: { pushIssue: "BadDeviceToken" } });
    expect(await deliverMessagePush(deps, s.replyId, once)).toBe("delivered");
    const request = production.requests.find((r) => r.deviceToken === s.token)!;
    expect(request.headers["apns-topic"]).toBe("com.example.lockdlist");
    expect(request.payload).toEqual({
      aps: { alert: { title: "LockdList", body: "Ada: Try pulling to refresh" }, sound: "default", badge: 3, "thread-id": s.conversationId },
      hshelby: { conversationId: s.conversationId, messageId: s.replyId },
    });
    expect((await s.device()).pushIssue).toBeNull();
  });

  it("leaves the badge to apps that own it", async () => {
    const s = await scenario({ device: { updatesAppBadge: false, pushEnv: "sandbox" } });
    await deliverMessagePush(deps, s.replyId, once);
    expect(sandbox.requests.find((r) => r.deviceToken === s.token)!.payload.aps).not.toHaveProperty("badge");
  });

  it("skips the user's own messages, apps without push, and devices that can't receive it", async () => {
    const s = await scenario();
    expect(await deliverMessagePush(deps, s.userMessageId, once)).toBe("skipped");
    expect(await deliverMessagePush(deps, randomUUID(), once)).toBe("skipped");
    expect(await deliverMessagePush(deps, (await scenario({ push: false })).replyId, once)).toBe("skipped");
    expect(await deliverMessagePush(deps, (await scenario({ device: { pushToken: null } })).replyId, once)).toBe("skipped");
    expect(await deliverMessagePush(deps, (await scenario({ device: { signedOutAt: new Date() } })).replyId, once)).toBe("skipped");
  });

  it("drops a token APNs says is gone", async () => {
    const s = await scenario();
    production.answer(s.token, 410, "Unregistered");
    expect(await deliverMessagePush(deps, s.replyId, once)).toBe("token_gone");
    expect(await s.device()).toMatchObject({ pushToken: null, pushIssue: "Unregistered" });
  });

  it("records a bad device token on the device and keeps it", async () => {
    const s = await scenario();
    production.answer(s.token, 400, "BadDeviceToken");
    expect(await deliverMessagePush(deps, s.replyId, once)).toBe("device_issue");
    expect(await s.device()).toMatchObject({ pushToken: s.token, pushIssue: "BadDeviceToken" });
  });

  it("flags the app's config when APNs rejects the key", async () => {
    const s = await scenario({ p8: generateP8().p8 });
    expect(await deliverMessagePush(deps, s.replyId, once)).toBe("config_issue");
    expect((await s.config())!.issue).toBe("InvalidProviderToken");
  });

  it("asks for a retry on server errors, and records the failure on the last attempt", async () => {
    const s = await scenario();
    production.answer(s.token, 503, "ServiceUnavailable");
    await expect(deliverMessagePush(deps, s.replyId, once)).rejects.toBeInstanceOf(PushRetryError);
    expect((await s.device()).pushIssue).toBeNull();
    expect(await deliverMessagePush(deps, s.replyId, { lastAttempt: true })).toBe("retry");
    expect((await s.device()).pushIssue).toBe("ServiceUnavailable");
  });
});
