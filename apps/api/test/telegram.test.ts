/* eslint-disable @typescript-eslint/no-explicit-any -- response bodies are asserted on, not typed */
import { randomUUID } from "node:crypto";
import { conversations, devices, telegramBots } from "@hshelby/db";
import { scheduleNotify, sendTelegramJob, TEAM_NOTIFY_QUEUE, TELEGRAM_QUEUE, type TeamNotifyJob, type TelegramJob } from "@hshelby/telegram";
import { startFakeTelegram } from "@hshelby/telegram/testing";
import { eq } from "drizzle-orm";
import { PgBoss } from "pg-boss";
import { afterAll, describe, expect, it } from "vitest";
import { joinAsMember, makeTestApp, registerDevice, reply, workspaceWithApp } from "./helpers";

let route: (url: string, init: RequestInit) => Promise<Response> = () => Promise.reject(new Error("not ready"));
const fake = await startFakeTelegram({ webhookFetch: (url, init) => route(url, init) });
const { app, deps, close } = await makeTestApp({}, { TELEGRAM_API_URL: fake.url, TELEGRAM_CHAT_INTERVAL_MS: "0" });
route = async (url, init) => app.request(new URL(url).pathname, init);

// The worker's side, run by hand: team.notify jobs schedule telegram.send jobs, which call Telegram.
const boss = new PgBoss({ connectionString: process.env.TEST_DATABASE_URL ?? "postgres://postgres@localhost:5433/hshelby_test", schema: "pgboss", supervise: false, schedule: false });
await boss.start();
// other test files queue team.notify for every message; start from an empty queue
await boss.deleteQueuedJobs(TEAM_NOTIFY_QUEUE);
await boss.deleteQueuedJobs(TELEGRAM_QUEUE);
afterAll(async () => {
  await boss.stop({ graceful: false });
  await close();
  await fake.close();
});

async function drain() {
  for (let round = 0; round < 50; round++) {
    const notify = await boss.fetch<TeamNotifyJob>(TEAM_NOTIFY_QUEUE, { batchSize: 500 });
    for (const job of notify) {
      await scheduleNotify(deps.db, job.data, (next, startAfter, singletonKey) => boss.send(TELEGRAM_QUEUE, next, { startAfter, singletonKey }), 0);
    }
    if (notify.length) await boss.complete(TEAM_NOTIFY_QUEUE, notify.map((j) => j.id));
    const sends = await boss.fetch<TelegramJob>(TELEGRAM_QUEUE, { batchSize: 500 });
    for (const job of sends) {
      const outcome = await sendTelegramJob({ db: deps.db, telegram: deps.telegram, keyring: deps.keyring, intervalMs: 0 }, job.data, { lastAttempt: true });
      if (typeof outcome === "object") await boss.send(TELEGRAM_QUEUE, job.data, { startAfter: new Date(Date.now() + outcome.retryAfter * 1000) });
    }
    if (sends.length) await boss.complete(TELEGRAM_QUEUE, sends.map((j) => j.id));
    if (!notify.length && !sends.length) return;
  }
}

type Team = Awaited<ReturnType<typeof workspaceWithApp>>;

const connect = (team: Team, body: Record<string, unknown>) =>
  team.call(`/api/apps/${team.appId}/telegram`, { method: "PUT", body: JSON.stringify(body) });
const settings = async (team: Team) => (await (await team.call(`/api/apps/${team.appId}/telegram`)).json()) as any;

/** A workspace whose app posts to a fresh group, and a user who has written in. */
async function connected(chat: Partial<Parameters<typeof fake.addChat>[0]> = {}) {
  const team = await workspaceWithApp(app);
  const token = fake.addBot();
  const chatId = fake.addChat({ botTokens: [token], ...chat });
  const res = await connect(team, { botToken: token, chatId: String(chatId) });
  expect(res.status).toBe(200);
  const device = await registerDevice(app, team.publicId, { identity: { name: "Alex Rivera" } });
  const { conversation } = (await (await device.send("My lists stopped syncing")).json()) as any;
  await drain();
  const notification = fake.sentTo(chatId).at(-1)!;
  const post = (message: Record<string, unknown>, secret?: string) => fake.post(token, { chatId, ...message } as any, secret);
  const thread = async () => ((await (await team.call(`/api/conversations/${conversation.id}/messages`)).json()) as any).messages as any[];
  return { team, token, chatId, device, conversationId: conversation.id as string, notification, post, thread };
}

describe("connecting", () => {
  it("connects a bot to a group, sets its webhook and posts a confirmation", async () => {
    const team = await workspaceWithApp(app);
    const token = fake.addBot("lockdlist_support_bot");
    const chatId = fake.addChat({ botTokens: [token], title: "LockdList support" });
    const res = await connect(team, { botToken: token, chatId: String(chatId) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      status: "connected",
      bot: { username: "lockdlist_support_bot" },
      chat: { id: String(chatId), title: "LockdList support", type: "group" },
      topics: false,
      issue: null,
    });
    expect(JSON.stringify(body)).not.toContain(token);

    const [bot] = await deps.db.select().from(telegramBots).where(eq(telegramBots.username, "lockdlist_support_bot"));
    expect(bot!.tokenEnc).not.toContain(token.split(":")[1]);
    expect(fake.webhookOf(token)!.url).toBe(`https://api.test/webhooks/telegram/${bot!.id}`);
    expect(fake.sentTo(chatId)[0]!.text).toContain(`<b>Ada Lovelace's app</b> is connected`);
  });

  it("refuses a bad token, a chat the bot can't see, a channel, and another workspace's bot", async () => {
    const team = await workspaceWithApp(app);
    const token = fake.addBot();
    const code = async (res: Response) => ((await res.json()) as any).error.code;

    expect(await code(await connect(team, { botToken: `${token}x`, chatId: "-100" }))).toBe("telegram_invalid_token");
    expect(await code(await connect(team, { botToken: token, chatId: String(fake.addChat({ botTokens: [] })) }))).toBe("telegram_chat_unavailable");
    expect((await connect(team, { botToken: token, chatId: "not a chat" })).status).toBe(400);
    const channel = fake.addChat({ botTokens: [token], type: "channel" });
    expect(await code(await connect(team, { botToken: token, chatId: String(channel) }))).toBe("telegram_chat_unavailable");

    expect((await connect(team, { botToken: token, chatId: String(fake.addChat({ botTokens: [token] })) })).status).toBe(200);
    const other = await workspaceWithApp(app, "Grace Hopper");
    const res = await connect(other, { botToken: token, chatId: String(fake.addChat({ botTokens: [token] })) });
    expect(res.status).toBe(409);
    expect(await code(res)).toBe("telegram_bot_in_use");
  });

  it("pauses, tests, refuses topics without a forum, disconnects; members can't change it", async () => {
    const { team, token, chatId } = await connected();
    const patch = (body: unknown) => team.call(`/api/apps/${team.appId}/telegram`, { method: "PATCH", body: JSON.stringify(body) });
    expect(((await (await patch({ paused: true })).json()) as any).status).toBe("paused");
    expect((await patch({ topics: true })).status).toBe(422);

    const before = fake.sentTo(chatId).length;
    expect((await team.call(`/api/apps/${team.appId}/telegram/test`, { method: "POST" })).status).toBe(200);
    expect(fake.sentTo(chatId).length).toBe(before + 1);

    const member = await joinAsMember(app, deps, team.call);
    expect((await member.call(`/api/apps/${team.appId}/telegram`, { method: "DELETE" })).status).toBe(403);
    expect(((await (await member.call(`/api/apps/${team.appId}/telegram`)).json()) as any).status).toBe("paused");

    expect((await team.call(`/api/apps/${team.appId}/telegram`, { method: "DELETE" })).status).toBe(204);
    expect(fake.webhookOf(token)).toBeNull();
    expect((await settings(team)).status).toBe("not_set_up");
  });
});

describe("notifications", () => {
  it("posts each customer message with the app, the user and a check for verified users", async () => {
    const { chatId, notification, device } = await connected();
    expect(notification.text).toBe("<b>Ada Lovelace's app · Alex Rivera</b>\nMy lists stopped syncing");
    expect(notification.silent).toBe(false);

    await deps.db.update(devices).set({ verified: true }).where(eq(devices.name, "Alex Rivera"));
    await device.send("Is <this> & that ok?");
    await drain();
    expect(fake.sentTo(chatId).at(-1)!.text).toBe("<b>Ada Lovelace's app · Alex Rivera</b> ✓\nIs &lt;this&gt; &amp; that ok?");
  });

  it("posts nothing while paused, and doesn't replay what was missed", async () => {
    const { team, chatId, device } = await connected();
    const patch = (paused: boolean) => team.call(`/api/apps/${team.appId}/telegram`, { method: "PATCH", body: JSON.stringify({ paused }) });
    await patch(true);
    await device.send("While paused");
    await drain();
    await patch(false);
    await device.send("After resuming");
    await drain();
    // after the connection's confirmation
    expect(fake.sentTo(chatId).slice(1).map((m) => (m.text ?? "").split("\n")[1])).toEqual(["My lists stopped syncing", "After resuming"]);
  });

  it("mirrors inbox replies silently, under the customer's latest notification", async () => {
    const { team, chatId, conversationId, notification } = await connected();
    await reply(team.call, conversationId, "Pull down to refresh.");
    await drain();
    const mirror = fake.sentTo(chatId).at(-1)!;
    expect(mirror).toMatchObject({ text: "<b>Ada</b>: Pull down to refresh.", silent: true, reply_to_message: { message_id: notification.message_id } });
  });

  it("announces an AI handover out loud; a Reply to it answers the person and keeps the AI out", async () => {
    const { team, chatId, conversationId, notification, post, thread } = await connected();
    const [question] = await thread();
    await deps.jobs.notifyHandover(deps.db, question.id, "Wants a refund");
    await drain();
    const handover = fake.sentTo(chatId).at(-1)!;
    expect(handover).toMatchObject({ text: "🙋 <b>Handed over by AI</b>: Wants a refund", silent: false, reply_to_message: { message_id: notification.message_id } });

    await post({ text: "I'll sort it out", reply_to_message: { message_id: handover.message_id } });
    expect((await thread()).at(-1)).toMatchObject({ source: "telegram", text: "I'll sort it out" });
    const { conversation } = (await (await team.call(`/api/conversations/${conversationId}`)).json()) as any;
    expect(conversation.ai).toBeNull();
    const [row] = await deps.db.select({ aiState: conversations.aiState }).from(conversations).where(eq(conversations.id, conversationId));
    expect(row!.aiState).toBe("paused");
  });
});

describe("replies from Telegram", () => {
  it("a Reply to a notification lands in the app chat once, with a 👍", async () => {
    const { chatId, notification, post, thread, device, token } = await connected();
    const { status, update } = await post({ text: "Try pulling down to refresh", reply_to_message: { message_id: notification.message_id } });
    expect(status).toBe(200);
    // Telegram redelivers when it isn't sure we got it
    expect((await fake.deliver(token, update)).status).toBe(200);

    const replies = (await thread()).filter((m) => m.sender === "agent");
    expect(replies).toHaveLength(1);
    expect(replies[0]).toMatchObject({ source: "telegram", text: "Try pulling down to refresh", author: { name: "Ada Lovelace" } });
    const { messages } = (await (await device.sdk("/v1/conversation")).json()) as any;
    expect(messages.at(-1)).toMatchObject({ sender: "agent", text: "Try pulling down to refresh" });

    await drain();
    expect(fake.messages.find((m) => m.chat.id === chatId && m.message_id === update.message!.message_id)!.reaction).toBe("👍");
    // a Telegram reply isn't mirrored back
    expect(fake.sentTo(chatId).filter((m) => (m.text ?? "").includes("Try pulling"))).toEqual([]);
  });

  it("routes replies to mirrored answers too, and ignores everything else", async () => {
    const { team, conversationId, chatId, post, thread } = await connected();
    await reply(team.call, conversationId, "Which iPhone?");
    await drain();
    const mirror = fake.sentTo(chatId).at(-1)!;
    await post({ text: "Asking about the model", reply_to_message: { message_id: mirror.message_id } });

    await post({ text: "Just chatting in the group" });
    await post({ text: "Bot talk", from: { id: 1, is_bot: true, first_name: "Other bot" }, reply_to_message: { message_id: mirror.message_id } });
    await post({ text: "Forwarded", forward_origin: { type: "user" }, reply_to_message: { message_id: mirror.message_id } });
    await post({ reply_to_message: { message_id: mirror.message_id } }); // a photo: no text
    await post({ text: "Reply to something else", reply_to_message: { message_id: 1 } });

    expect((await thread()).filter((m) => m.source === "telegram").map((m) => m.text)).toEqual(["Asking about the model"]);
  });

  it("answers a too-long reply and a lapsed forgery the right way", async () => {
    const { chatId, notification, post, thread } = await connected();
    await post({ text: "x".repeat(4001), reply_to_message: { message_id: notification.message_id } });
    await drain();
    expect(fake.sentTo(chatId).at(-1)!.text).toContain("Not sent: replies can be up to 4,000 characters.");
    expect((await post({ text: "Forged", reply_to_message: { message_id: notification.message_id } }, "wrong-secret")).status).toBe(401);
    expect((await thread()).filter((m) => m.sender === "agent")).toEqual([]);
  });

  it("says “Reply sent.” where reactions are off, and posts as the team when there are several teammates", async () => {
    const { team, chatId, notification, post, thread } = await connected({ reactions: false });
    await joinAsMember(app, deps, team.call);
    const { update } = await post({ text: "We're on it", reply_to_message: { message_id: notification.message_id } });
    await drain();
    const confirmation = fake.sentTo(chatId).at(-1)!;
    expect(confirmation).toMatchObject({ text: "Reply sent.", reply_to_message: { message_id: update.message!.message_id }, silent: true });
    expect((await thread()).at(-1)).toMatchObject({ source: "telegram", author: null });
  });
});

describe("chat changes", () => {
  it("follows a group that became a supergroup", async () => {
    const { team, chatId, device, token } = await connected();
    const supergroup = fake.migrate(chatId);
    await device.send("Still there?");
    await drain();
    expect(fake.sentTo(supergroup).at(-1)!.text).toContain("Still there?");
    expect((await settings(team)).chat).toMatchObject({ id: String(supergroup), type: "supergroup" });

    // replies in the new chat route as before
    const post = fake.sentTo(supergroup).at(-1)!;
    await fake.post(token, { chatId: supergroup, text: "Yes!", reply_to_message: { message_id: post.message_id } });
    expect(((await (await device.sdk("/v1/conversation")).json()) as any).messages.at(-1).text).toBe("Yes!");
  });

  it("shows the issue when the bot was removed from the chat", async () => {
    const { team, chatId, device, token } = await connected();
    fake.removeBotFrom(chatId, token);
    await device.send("Hello?");
    await drain();
    expect((await settings(team)).issue).toContain("kicked");
  });

  it("gives each customer a forum topic and routes messages in it without a Reply", async () => {
    const { team, token, chatId, device, conversationId, thread } = await connected({ type: "supergroup", is_forum: true, topicsAdmin: true });
    const patch = await team.call(`/api/apps/${team.appId}/telegram`, { method: "PATCH", body: JSON.stringify({ topics: true }) });
    expect(patch.status).toBe(200);
    await device.send("Topic please");
    await drain();
    const created = fake.calls.filter((c) => c.method === "createForumTopic" && c.params.chat_id === chatId);
    expect(created.map((c) => c.params.name)).toEqual(["Ada Lovelace's app · Alex Rivera"]);
    const inTopic = fake.sentTo(chatId).at(-1)!;
    expect(inTopic.message_thread_id).toBeGreaterThan(0);

    await fake.post(token, { chatId, text: "Answering in the topic", message_thread_id: inTopic.message_thread_id, is_topic_message: true });
    expect((await thread()).at(-1)).toMatchObject({ source: "telegram", text: "Answering in the topic" });
    expect(conversationId).toBeTruthy();

    // someone deleted the topic: the next message makes a new one
    fake.failNext("sendMessage", { code: 400, description: "Bad Request: message thread not found" }, chatId);
    await device.send("Anyone?");
    await drain();
    expect(fake.calls.filter((c) => c.method === "createForumTopic" && c.params.chat_id === chatId)).toHaveLength(2);
    expect(fake.sentTo(chatId).at(-1)!.text).toContain("Anyone?");
  });

  it("reschedules after Telegram says to slow down", async () => {
    const { chatId, device } = await connected();
    fake.failNext("sendMessage", { code: 429, description: "Too Many Requests: retry after 1", retryAfter: 1 }, chatId);
    const text = `Burst ${randomUUID()}`;
    await device.send(text);
    await drain();
    expect(fake.sentTo(chatId).some((m) => (m.text ?? "").includes(text))).toBe(false);
    await new Promise((r) => setTimeout(r, 1100));
    await drain();
    expect(fake.sentTo(chatId).at(-1)!.text).toContain(text);
  });
});
