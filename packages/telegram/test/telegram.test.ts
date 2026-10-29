import { afterAll, describe, expect, it } from "vitest";
import { createTelegramClient, TelegramError } from "../src/client";
import { clip, mirrorHtml, notificationHtml, topicName } from "../src/format";
import { startFakeTelegram } from "../src/testing";

const fake = await startFakeTelegram();
const telegram = createTelegramClient({ baseUrl: fake.url });
afterAll(() => fake.close());

const text = (t: string) => ({ text: t, kind: "text" as const, card: null, photos: 0 });

describe("formatting", () => {
  it("escapes HTML, marks verified users and describes what isn't text", () => {
    expect(notificationHtml({ ...text("a <b> & c"), appName: "Lists & Co", userLabel: "Alex", verified: true })).toBe(
      "<b>Lists &amp; Co · Alex</b> ✓\na &lt;b&gt; &amp; c",
    );
    expect(notificationHtml({ ...text(""), photos: 2, appName: "A", userLabel: "B", verified: false })).toBe("<b>A · B</b>\n📷 2 photos");
    const offer = { text: "", kind: "paywall" as const, card: { type: "paywall" as const, paywallId: "p", paywallTitle: "Pro", buttonLabel: null }, photos: 0 };
    expect(mirrorHtml({ ...offer, senderName: "Ada" })).toBe("<b>Ada</b>: Sent an offer: Pro");
  });

  it("cuts long text without splitting emoji", () => {
    expect(clip("👍".repeat(10), 5)).toBe("👍👍👍👍…");
    expect(notificationHtml({ ...text("x".repeat(5000)), appName: "A", userLabel: "B", verified: false }).length).toBeLessThan(3600);
    expect(topicName("A".repeat(100), "B".repeat(100))).toHaveLength(128);
  });
});

describe("client", () => {
  it("turns Telegram's refusals into errors with their parameters", async () => {
    const token = fake.addBot();
    const chatId = fake.addChat({ botTokens: [token] });
    await expect(telegram.getMe(`${token}x`)).rejects.toMatchObject({ code: 401 });

    fake.failNext("sendMessage", { code: 429, description: "Too Many Requests: retry after 7", retryAfter: 7 });
    const limited = await telegram.sendMessage(token, chatId, "hi").catch((e: unknown) => e);
    expect(limited).toBeInstanceOf(TelegramError);
    expect(limited).toMatchObject({ code: 429, retryAfter: 7, isRetryable: true });

    const gone = (await telegram.sendMessage(token, -42, "hi").catch((e: TelegramError) => e)) as TelegramError;
    expect(gone.isChatGone).toBe(true);
    fake.removeBotFrom(chatId, token);
    expect(((await telegram.sendMessage(token, chatId, "hi").catch((e: TelegramError) => e)) as TelegramError).isChatGone).toBe(true);

    const unreachable = createTelegramClient({ baseUrl: "http://127.0.0.1:1", timeoutMs: 500 });
    expect(await unreachable.getMe(token).catch((e: TelegramError) => e.isRetryable)).toBe(true);
  });
});
