/* A small Telegram Bot API client: the methods the integration uses, and Telegram's errors as data. */

export type TelegramChat = {
  id: number;
  type: "private" | "group" | "supergroup" | "channel";
  title?: string;
  username?: string;
  first_name?: string;
  is_forum?: boolean;
};

export type TelegramUser = { id: number; is_bot: boolean; first_name: string; username?: string };

export type TelegramMessage = {
  message_id: number;
  chat: TelegramChat;
  from?: TelegramUser;
  sender_chat?: TelegramChat;
  date: number;
  text?: string;
  message_thread_id?: number;
  is_topic_message?: boolean;
  reply_to_message?: { message_id: number };
  forward_origin?: unknown;
  migrate_to_chat_id?: number;
  migrate_from_chat_id?: number;
};

export type TelegramUpdate = { update_id: number; message?: TelegramMessage };

/** An answer with `ok: false`. `retryAfter` comes with 429s; `migrateToChatId` when a group became a supergroup. */
export class TelegramError extends Error {
  constructor(
    readonly code: number,
    readonly description: string,
    readonly retryAfter?: number,
    readonly migrateToChatId?: number,
  ) {
    super(`Telegram ${code}: ${description}`);
  }

  /** The bot can't post there any more (removed, blocked, chat gone, no rights): retrying won't help. */
  get isChatGone() {
    return this.code === 403 || (this.code === 400 && /chat not found|not enough rights|have no rights|CHAT_WRITE_FORBIDDEN/i.test(this.description));
  }

  get isThreadGone() {
    return this.code === 400 && /thread not found|TOPIC_DELETED|TOPIC_CLOSED/i.test(this.description);
  }

  /** 429, 5xx and network trouble. */
  get isRetryable() {
    return this.code === 429 || this.code >= 500 || this.code === 0;
  }
}

export type SendMessageOptions = {
  threadId?: number;
  replyTo?: number;
  silent?: boolean;
};

export type TelegramClient = ReturnType<typeof createTelegramClient>;

export function createTelegramClient(options: { baseUrl?: string; timeoutMs?: number } = {}) {
  const baseUrl = (options.baseUrl ?? "https://api.telegram.org").replace(/\/$/, "");
  const timeoutMs = options.timeoutMs ?? 10_000;

  async function call<T>(token: string, method: string, params: Record<string, unknown> = {}): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${baseUrl}/bot${token}/${method}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(params),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      throw new TelegramError(0, err instanceof Error ? err.message : "network error");
    }
    const body = (await res.json().catch(() => null)) as {
      ok: boolean;
      result?: T;
      error_code?: number;
      description?: string;
      parameters?: { retry_after?: number; migrate_to_chat_id?: number };
    } | null;
    if (!body?.ok) {
      throw new TelegramError(
        body?.error_code ?? res.status,
        body?.description ?? `HTTP ${res.status}`,
        body?.parameters?.retry_after,
        body?.parameters?.migrate_to_chat_id,
      );
    }
    return body.result as T;
  }

  return {
    call,
    getMe: (token: string) => call<TelegramUser & { username: string }>(token, "getMe"),
    getChat: (token: string, chatId: number | string) => call<TelegramChat>(token, "getChat", { chat_id: chatId }),
    getChatMember: (token: string, chatId: number, userId: number) =>
      call<{ status: string; can_manage_topics?: boolean }>(token, "getChatMember", { chat_id: chatId, user_id: userId }),
    setWebhook: (token: string, url: string, secretToken: string) =>
      call<true>(token, "setWebhook", { url, secret_token: secretToken, allowed_updates: ["message"] }),
    deleteWebhook: (token: string) => call<true>(token, "deleteWebhook"),
    /** HTML-formatted text. */
    sendMessage: (token: string, chatId: number, html: string, opts: SendMessageOptions = {}) =>
      call<TelegramMessage>(token, "sendMessage", {
        chat_id: chatId,
        text: html,
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
        ...(opts.threadId && { message_thread_id: opts.threadId }),
        ...(opts.replyTo && { reply_parameters: { message_id: opts.replyTo, allow_sending_without_reply: true } }),
        ...(opts.silent && { disable_notification: true }),
      }),
    setMessageReaction: (token: string, chatId: number, messageId: number, emoji: string) =>
      call<true>(token, "setMessageReaction", { chat_id: chatId, message_id: messageId, reaction: [{ type: "emoji", emoji }] }),
    createForumTopic: (token: string, chatId: number, name: string) =>
      call<{ message_thread_id: number; name: string }>(token, "createForumTopic", { chat_id: chatId, name }),
    editForumTopic: (token: string, chatId: number, threadId: number, name: string) =>
      call<true>(token, "editForumTopic", { chat_id: chatId, message_thread_id: threadId, name }),
  };
}
