import { decodeJwt, decodeProtectedHeader } from "jose";
import { afterAll, describe, expect, it } from "vitest";
import { buildPushPayload, classify, createApnsClient, fillTemplate, type ApnsResult } from "../src";
import { generateP8, startFakeApns } from "../src/testing";

const key = generateP8();
const creds = { teamId: "TEAM123456", keyId: "KEY1234567", p8: key.p8 };
const sandbox = await startFakeApns({ verifyWith: key.publicKey, keyId: creds.keyId, teamId: creds.teamId });
const production = await startFakeApns({ verifyWith: key.publicKey, keyId: creds.keyId, teamId: creds.teamId });
const apns = createApnsClient({ hosts: { sandbox: sandbox.url, production: production.url } });
afterAll(async () => {
  apns.close();
  await Promise.all([sandbox.close(), production.close()]);
});

const token = (n: number) => n.toString(16).padStart(64, "0");
const notification = (deviceToken: string) => ({
  deviceToken,
  topic: "com.example.lockdlist",
  payload: { aps: { alert: { title: "t", body: "b" } } },
});

describe("APNs client", () => {
  it("sends to the device's environment with token auth and the right headers", async () => {
    const result = await apns.send(creds, "sandbox", notification(token(1)));
    expect(result).toMatchObject({ ok: true, status: 200 });
    expect(production.requests).toHaveLength(0);

    const [request] = sandbox.requests;
    expect(request!.deviceToken).toBe(token(1));
    expect(request!.headers).toMatchObject({
      ":method": "POST",
      "apns-topic": "com.example.lockdlist",
      "apns-push-type": "alert",
      "apns-priority": "10",
    });
    const expiration = Number(request!.headers["apns-expiration"]);
    expect(expiration - Date.now() / 1000).toBeGreaterThan(86_000);

    const jwt = String(request!.headers.authorization).replace("bearer ", "");
    expect(decodeProtectedHeader(jwt)).toEqual({ alg: "ES256", kid: "KEY1234567" });
    expect(decodeJwt(jwt)).toMatchObject({ iss: "TEAM123456" });

    await apns.send(creds, "production", notification(token(2)));
    expect(production.requests.map((r) => r.deviceToken)).toEqual([token(2)]);
  });

  it("reuses the provider token between sends", async () => {
    await apns.send(creds, "sandbox", notification(token(3)));
    const [a, b] = sandbox.requests.slice(-2);
    expect(a!.headers.authorization).toBe(b!.headers.authorization);
  });

  it("reports APNs rejections with their reason", async () => {
    sandbox.answer(token(4), 410, "Unregistered");
    expect(await apns.send(creds, "sandbox", notification(token(4)))).toEqual({ ok: false, status: 410, reason: "Unregistered" });

    const wrongKey = { ...creds, p8: generateP8().p8 };
    expect(await apns.send(wrongKey, "sandbox", notification(token(5)))).toMatchObject({ status: 403, reason: "InvalidProviderToken" });
  });

  it("turns a dead connection into a retryable result", async () => {
    const offline = createApnsClient({ hosts: { sandbox: "http://127.0.0.1:1" }, timeoutMs: 2000 });
    const result = await offline.send(creds, "sandbox", notification(token(6)));
    offline.close();
    expect(result).toMatchObject({ ok: false, status: 0 });
    expect(classify(result)).toBe("retry");
  });

  it.each([
    [{ ok: true, status: 200, apnsId: null }, "delivered"],
    [{ ok: false, status: 410, reason: "Unregistered" }, "token_gone"],
    [{ ok: false, status: 410, reason: "ExpiredToken" }, "token_gone"],
    [{ ok: false, status: 400, reason: "BadDeviceToken" }, "device_issue"],
    [{ ok: false, status: 400, reason: "DeviceTokenNotForTopic" }, "device_issue"],
    [{ ok: false, status: 400, reason: "TopicDisallowed" }, "config_issue"],
    [{ ok: false, status: 403, reason: "InvalidProviderToken" }, "config_issue"],
    [{ ok: false, status: 403, reason: "ExpiredProviderToken" }, "retry"],
    [{ ok: false, status: 429, reason: "TooManyRequests" }, "retry"],
    [{ ok: false, status: 503, reason: "ServiceUnavailable" }, "retry"],
  ] as [ApnsResult, string][])("classifies %o as %s", (result, outcome) => {
    expect(classify(result)).toBe(outcome);
  });
});

describe("notification content", () => {
  const settings = { titleTemplate: "{app}", bodyTemplate: "{agent}: {message}", senderName: null, showPreview: true, sound: true };

  it("fills the templates, badge, thread and conversation", () => {
    const payload = buildPushPayload(settings, {
      appName: "LockdList",
      authorName: "Ada Lovelace",
      message: "Try pulling\ndown to refresh",
      conversationId: "c1",
      messageId: "m1",
      badge: 2,
    });
    expect(payload).toEqual({
      aps: {
        alert: { title: "LockdList", body: "Ada: Try pulling down to refresh" },
        sound: "default",
        badge: 2,
        "thread-id": "c1",
      },
      hshelby: { conversationId: "c1", messageId: "m1" },
    });
  });

  it("hides the message, uses the sender name, and leaves out badge and sound when asked", () => {
    const payload = buildPushPayload(
      { ...settings, senderName: "LockdList Support", showPreview: false, sound: false },
      { appName: "LockdList", authorName: "Ada Lovelace", message: "secret details", conversationId: "c1", badge: null },
    );
    expect(payload.aps).toEqual({ alert: { title: "LockdList", body: "LockdList Support: New message" }, "thread-id": "c1" });
  });

  it("keeps placeholders inside the message literal and caps the lengths", () => {
    expect(fillTemplate("{agent}: {message}", { agent: "Ada", message: "I typed {agent} and {app}", app: "X" })).toBe(
      "Ada: I typed {agent} and {app}",
    );
    const long = buildPushPayload(settings, { appName: "A".repeat(150), authorName: null, message: "😀".repeat(600), conversationId: null, badge: null });
    expect(Array.from(long.aps.alert.title)).toHaveLength(100);
    expect(Array.from(long.aps.alert.body)).toHaveLength(500);
    expect(long.aps.alert.body.startsWith("Support: 😀")).toBe(true);
  });
});
