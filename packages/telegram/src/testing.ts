import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import type { TelegramChat, TelegramMessage, TelegramUpdate, TelegramUser } from "./client";

type Bot = { token: string; user: TelegramUser & { username: string }; webhook: { url: string; secret: string } | null };
type Chat = TelegramChat & { members: Map<number, { status: string; can_manage_topics?: boolean }>; reactions: boolean };
type Failure = { code: number; description: string; retryAfter?: number; migrateToChatId?: number };

export type FakeCall = { token: string; method: string; params: Record<string, unknown>; at: number };

/**
 * A local stand-in for the Telegram Bot API: bots, chats, messages, topics and reactions, with the errors
 * Telegram gives (401 bad token, 400 chat not found, 403 bot removed, 429 with retry_after, a group migrated
 * to a supergroup). It records every call, can enforce a per-chat rate limit like Telegram's, and delivers
 * updates to the webhook a bot registered, with its secret token header.
 */
export async function startFakeTelegram(
  options: {
    perChatLimit?: { count: number; windowMs: number };
    /** How updates reach the webhook; tests of an in-process app route them to it. */
    webhookFetch?: (url: string, init: RequestInit) => Promise<Response>;
  } = {},
) {
  const webhookFetch = options.webhookFetch ?? ((url, init) => fetch(url, init));
  const bots = new Map<string, Bot>();
  const chats = new Map<number, Chat>();
  const calls: FakeCall[] = [];
  const messages: (TelegramMessage & { silent: boolean; reaction?: string })[] = [];
  const failures: { method: string; chatId?: number; failure: Failure }[] = [];
  let nextMessageId = 100;
  let nextThreadId = 5000;
  let nextUpdateId = 1;
  const rateLimited: FakeCall[] = [];

  const fail = (f: Failure) => ({
    ok: false,
    error_code: f.code,
    description: f.description,
    ...((f.retryAfter || f.migrateToChatId) && { parameters: { retry_after: f.retryAfter, migrate_to_chat_id: f.migrateToChatId } }),
  });

  function handle(token: string, method: string, params: Record<string, unknown>) {
    const bot = bots.get(token);
    if (!bot) return fail({ code: 401, description: "Unauthorized" });
    const chatId = typeof params.chat_id === "number" ? params.chat_id : undefined;
    const planned = failures.findIndex((f) => f.method === method && (f.chatId === undefined || f.chatId === chatId));
    if (planned >= 0) return fail(failures.splice(planned, 1)[0]!.failure);

    if (method === "getMe") return { ok: true, result: bot.user };
    if (method === "setWebhook") {
      bot.webhook = { url: String(params.url), secret: String(params.secret_token) };
      return { ok: true, result: true };
    }
    if (method === "deleteWebhook") {
      bot.webhook = null;
      return { ok: true, result: true };
    }

    const chat =
      typeof params.chat_id === "string" ? [...chats.values()].find((c) => `@${c.username}` === params.chat_id) : chats.get(chatId!);
    if (!chat || !chat.members.has(bot.user.id)) return fail({ code: 400, description: "Bad Request: chat not found" });
    if (chat.members.get(bot.user.id)!.status === "kicked") return fail({ code: 403, description: "Forbidden: bot was kicked from the group chat" });

    switch (method) {
      case "getChat": {
        const { members: _m, reactions: _r, ...plain } = chat;
        return { ok: true, result: plain };
      }
      case "getChatMember":
        return { ok: true, result: chat.members.get(Number(params.user_id)) ?? { status: "left" } };
      case "sendMessage": {
        if (options.perChatLimit) {
          const windowStart = Date.now() - options.perChatLimit.windowMs;
          const recent = messages.filter((m) => m.chat.id === chat.id && m.from?.id === bot.user.id && m.date * 1 >= windowStart);
          if (recent.length >= options.perChatLimit.count) {
            rateLimited.push(calls.at(-1)!);
            return fail({ code: 429, description: "Too Many Requests: retry after 1", retryAfter: 1 });
          }
        }
        const threadId = params.message_thread_id as number | undefined;
        if (threadId && !chat.is_forum) return fail({ code: 400, description: "Bad Request: message thread not found" });
        const message = {
          message_id: nextMessageId++,
          chat: { id: chat.id, type: chat.type, title: chat.title },
          from: bot.user,
          // milliseconds, so the rate limit can be checked at test speed
          date: Date.now(),
          text: String(params.text),
          ...(threadId && { message_thread_id: threadId, is_topic_message: true }),
          ...(params.reply_parameters ? { reply_to_message: { message_id: (params.reply_parameters as { message_id: number }).message_id } } : {}),
          silent: params.disable_notification === true,
        };
        messages.push(message);
        return { ok: true, result: message };
      }
      case "setMessageReaction": {
        if (!chat.reactions) return fail({ code: 400, description: "Bad Request: REACTION_INVALID" });
        const target = messages.find((m) => m.chat.id === chat.id && m.message_id === params.message_id);
        if (!target) return fail({ code: 400, description: "Bad Request: message to react not found" });
        target.reaction = (params.reaction as { emoji: string }[])[0]?.emoji;
        return { ok: true, result: true };
      }
      case "createForumTopic": {
        if (!chat.is_forum) return fail({ code: 400, description: "Bad Request: the chat is not a forum" });
        if (!chat.members.get(bot.user.id)?.can_manage_topics) return fail({ code: 400, description: "Bad Request: not enough rights to create a topic" });
        return { ok: true, result: { message_thread_id: nextThreadId++, name: String(params.name) } };
      }
      case "editForumTopic":
        return { ok: true, result: true };
      default:
        return fail({ code: 404, description: "Not Found" });
    }
  }

  const readBody = (req: IncomingMessage) =>
    new Promise<string>((resolve) => {
      let body = "";
      req.setEncoding("utf8");
      req.on("data", (chunk: string) => (body += chunk));
      req.on("end", () => resolve(body));
    });

  const server = createServer(async (req, res) => {
    const match = /^\/bot([^/]+)\/(\w+)$/.exec(req.url ?? "");
    const params = JSON.parse((await readBody(req)) || "{}") as Record<string, unknown>;
    const answer = match ? handle(match[1]!, match[2]!, params) : fail({ code: 404, description: "Not Found" });
    if (match) calls.push({ token: match[1]!, method: match[2]!, params, at: Date.now() });
    res.writeHead(answer.ok ? 200 : (answer as { error_code: number }).error_code, { "content-type": "application/json" });
    res.end(JSON.stringify(answer));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  let botCounter = 0;
  const people = { alice: { id: 7001, is_bot: false, first_name: "Alice" }, bob: { id: 7002, is_bot: false, first_name: "Bob" } };

  return {
    url: `http://127.0.0.1:${port}`,
    calls,
    messages,
    rateLimited,
    people,
    /** A bot as BotFather would make it; returns its token. */
    addBot(username = `support_${++botCounter}_bot`) {
      const id = 600_000_000 + Math.floor(Math.random() * 99_999_999);
      const token = `${id}:${"A".repeat(10)}${Math.random().toString(36).slice(2).padEnd(25, "x")}`;
      bots.set(token, { token, user: { id, is_bot: true, first_name: "Support", username }, webhook: null });
      return token;
    },
    /** A chat with the given bots as members (admins with "Manage topics" when `topicsAdmin`). */
    addChat(chat: Partial<TelegramChat> & { botTokens: string[]; topicsAdmin?: boolean; reactions?: boolean }) {
      const id = chat.id ?? -(1_000_000_000 + chats.size);
      const members = new Map<number, { status: string; can_manage_topics?: boolean }>();
      for (const t of chat.botTokens) {
        members.set(bots.get(t)!.user.id, chat.topicsAdmin ? { status: "administrator", can_manage_topics: true } : { status: "member" });
      }
      chats.set(id, { id, type: chat.type ?? "group", title: chat.title ?? "Support team", username: chat.username, is_forum: chat.is_forum, members, reactions: chat.reactions ?? true });
      return id;
    },
    removeBotFrom(chatId: number, token: string) {
      chats.get(chatId)!.members.set(bots.get(token)!.user.id, { status: "kicked" });
    },
    /** Telegram moving a group to a supergroup: the old ID stops working with migrate_to_chat_id. */
    migrate(fromChatId: number) {
      const chat = chats.get(fromChatId)!;
      const toChatId = -(1_000_000_000_000 + Math.abs(fromChatId));
      chats.set(toChatId, { ...chat, id: toChatId, type: "supergroup" });
      for (const m of messages) if (m.chat.id === fromChatId) m.chat = { ...m.chat, id: toChatId };
      failures.push({ method: "sendMessage", chatId: fromChatId, failure: { code: 400, description: "Bad Request: group chat was upgraded to a supergroup chat", migrateToChatId: toChatId } });
      return toChatId;
    },
    /** The next call of `method` (to `chatId`, if given) fails like this. */
    failNext(method: string, failure: Failure, chatId?: number) {
      failures.push({ method, chatId, failure });
    },
    webhookOf(token: string) {
      return bots.get(token)!.webhook;
    },
    /** What the bot posted in a chat, oldest first. */
    sentTo(chatId: number) {
      return messages.filter((m) => m.chat.id === chatId && m.from?.is_bot);
    },
    /**
     * A person posts in a chat; the update goes to the bot's webhook. Returns the webhook's HTTP status.
     * `secret` overrides the secret token header (to test forgeries).
     */
    async post(token: string, message: Partial<TelegramMessage> & { chatId: number; from?: TelegramUser }, secret?: string) {
      const bot = bots.get(token)!;
      const chat = chats.get(message.chatId)!;
      const { chatId: _c, ...rest } = message;
      const full: TelegramMessage = {
        message_id: nextMessageId++,
        chat: { id: chat.id, type: chat.type, title: chat.title },
        from: people.alice,
        date: Date.now(),
        ...rest,
      };
      messages.push({ ...full, silent: false });
      return this.deliver(token, { update_id: nextUpdateId++, message: full }, secret ?? bot.webhook?.secret);
    },
    /** Delivers an update as is (e.g. the same one twice, as Telegram does after a failed delivery). */
    async deliver(token: string, update: TelegramUpdate, secret = bots.get(token)!.webhook?.secret) {
      const webhook = bots.get(token)!.webhook;
      if (!webhook) throw new Error("no webhook set");
      const res = await webhookFetch(webhook.url, {
        method: "POST",
        headers: { "content-type": "application/json", ...(secret && { "x-telegram-bot-api-secret-token": secret }) },
        body: JSON.stringify(update),
      });
      return { status: res.status, update };
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

export type FakeTelegram = Awaited<ReturnType<typeof startFakeTelegram>>;
