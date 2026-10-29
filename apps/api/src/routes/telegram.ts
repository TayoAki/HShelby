import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { TELEGRAM_REPLY_MAX, TelegramConnectInput, TelegramUpdateInput, type TelegramSettings } from "@hshelby/contracts";
import { decryptSecret, encryptSecret, uuidv7 } from "@hshelby/core";
import { apps, auditEvents, conversations, members, telegramBots, telegramConnections, telegramPosts, telegramTopics, type Db, type Tx } from "@hshelby/db";
import { escapeHtml, migrateChat, reserveSlot, TelegramError, type TelegramJob, type TelegramMessage, type TelegramUpdate } from "@hshelby/telegram";
import { and, count, eq } from "drizzle-orm";
import { Hono } from "hono";
import type { AppEnv, Deps } from "../context";
import { ApiError, isUniqueViolation } from "../errors";
import { appendAgentMessage } from "../messaging";
import { requireOrgAdmin } from "../middleware";
import { isUuid, parseJson } from "../validation";
import { findOrgApp } from "./apps";

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

/** Telegram's own words for a refusal, for the dashboard. */
const refusal = (err: unknown) => (err instanceof TelegramError ? err.description.replace(/^(Bad Request|Forbidden): /, "") : "Telegram didn't respond");

/** Connecting, pausing, testing and disconnecting an app's Telegram, under /api/apps/:id/telegram. Admins change it. */
export function telegramSettingsRoutes(deps: Deps) {
  const { db, telegram } = deps;
  const r = new Hono<AppEnv>();

  async function settings(appId: string): Promise<TelegramSettings> {
    const [row] = await db
      .select({ connection: telegramConnections, username: telegramBots.username })
      .from(telegramConnections)
      .innerJoin(telegramBots, eq(telegramBots.id, telegramConnections.botId))
      .where(eq(telegramConnections.appId, appId));
    if (!row) return { status: "not_set_up", bot: null, chat: null, topics: false, issue: null, issueAt: null, connectedAt: null };
    const c = row.connection;
    return {
      status: c.paused ? "paused" : "connected",
      bot: { username: row.username },
      chat: { id: String(c.chatId), title: c.chatTitle, type: c.chatType },
      topics: c.topics,
      issue: c.issue,
      issueAt: c.issueAt?.toISOString() ?? null,
      connectedAt: c.connectedAt.toISOString(),
    };
  }

  async function connectionOf(appId: string) {
    const [row] = await db
      .select({ connection: telegramConnections, bot: telegramBots })
      .from(telegramConnections)
      .innerJoin(telegramBots, eq(telegramBots.id, telegramConnections.botId))
      .where(eq(telegramConnections.appId, appId));
    if (!row) throw new ApiError(404, "telegram_not_connected", "Telegram isn't set up for this app");
    return { ...row, token: decryptSecret(row.bot.tokenEnc, deps.keyring) };
  }

  const audit = (orgId: string, userId: string, action: string, target: string, metadata?: Record<string, unknown>) =>
    db.insert(auditEvents).values({ id: uuidv7(), organizationId: orgId, userId, action, target, metadata });

  r.get("/:id/telegram", async (c) => {
    const app = await findOrgApp(db, c.get("org").id, c.req.param("id"));
    return c.json(await settings(app.id));
  });

  /**
   * Connects the app to a chat: checks the token and the chat, points the bot's webhook at this API (one
   * webhook per bot, shared by the workspace's apps), and posts a confirmation there.
   */
  r.put("/:id/telegram", requireOrgAdmin, async (c) => {
    const input = await parseJson(c, TelegramConnectInput);
    const org = c.get("org");
    const app = await findOrgApp(db, org.id, c.req.param("id"));

    const me = await telegram.getMe(input.botToken).catch(() => {
      throw new ApiError(422, "telegram_invalid_token", "Telegram doesn't recognise that bot token. Copy it again from BotFather.");
    });
    const chatRef = /^-?\d+$/.test(input.chatId) ? Number(input.chatId) : input.chatId;
    const chat = await telegram.getChat(input.botToken, chatRef).catch((err: unknown) => {
      throw new ApiError(422, "telegram_chat_unavailable", `The bot can't see that chat (${refusal(err)}). Add @${me.username} to it first, then check the chat ID.`);
    });
    if (chat.type === "channel") throw new ApiError(422, "telegram_chat_unavailable", "Channels aren't supported: use a group or a private chat");

    const [existing] = await db.select().from(telegramBots).where(eq(telegramBots.telegramBotId, me.id));
    if (existing && existing.organizationId !== org.id) {
      throw new ApiError(409, "telegram_bot_in_use", "This bot is connected to another workspace. Create a new bot with BotFather.");
    }
    const botId = existing?.id ?? uuidv7();
    const secret = randomBytes(32).toString("base64url");
    const base = (deps.env.PUBLIC_API_URL ?? new URL(c.req.url).origin).replace(/\/$/, "");
    await telegram.setWebhook(input.botToken, `${base}/webhooks/telegram/${botId}`, secret).catch((err: unknown) => {
      throw new ApiError(422, "telegram_invalid_token", `Telegram refused the webhook: ${refusal(err)}`);
    });

    const values = { username: me.username, tokenEnc: encryptSecret(input.botToken, deps.keyring), webhookSecretHash: sha256(secret), updatedAt: new Date() };
    if (existing) await db.update(telegramBots).set(values).where(eq(telegramBots.id, botId));
    else await db.insert(telegramBots).values({ id: botId, organizationId: org.id, telegramBotId: me.id, ...values });

    // a post proves the bot may write there
    await telegram
      .sendMessage(input.botToken, chat.id, `✅ <b>${escapeHtml(app.name)}</b> is connected. Customer messages appear here; reply to one to answer in the app.`)
      .catch((err: unknown) => {
        throw new ApiError(422, "telegram_chat_unavailable", `The bot can't post in that chat: ${refusal(err)}`);
      });

    const connection = {
      botId,
      chatId: chat.id,
      chatTitle: chat.title ?? chat.username ?? chat.first_name ?? null,
      chatType: chat.type,
      paused: false,
      topics: false,
      issue: null,
      issueAt: null,
      connectedAt: new Date(),
      updatedAt: new Date(),
    } as const;
    await db
      .insert(telegramConnections)
      .values({ appId: app.id, ...connection })
      .onConflictDoUpdate({ target: telegramConnections.appId, set: connection });
    await audit(org.id, c.get("user").id, "telegram.connected", app.id, { bot: me.username, chatId: String(chat.id) });
    return c.json(await settings(app.id));
  });

  /** Pause or resume, and switch per-customer topics (which need a forum group and "Manage topics"). */
  r.patch("/:id/telegram", requireOrgAdmin, async (c) => {
    const input = await parseJson(c, TelegramUpdateInput);
    const app = await findOrgApp(db, c.get("org").id, c.req.param("id"));
    const { connection, bot, token } = await connectionOf(app.id);
    if (input.topics) {
      const chat = await telegram.getChat(token, connection.chatId).catch(() => null);
      const member = await telegram.getChatMember(token, connection.chatId, bot.telegramBotId).catch(() => null);
      if (!chat?.is_forum || !member?.can_manage_topics) {
        throw new ApiError(
          422,
          "telegram_chat_unavailable",
          "Topics need a group with Topics turned on, and the bot as an admin with “Manage topics”.",
        );
      }
    }
    await db
      .update(telegramConnections)
      .set({ ...input, ...(input.paused === false && { issue: null, issueAt: null }), updatedAt: new Date() })
      .where(eq(telegramConnections.appId, app.id));
    return c.json(await settings(app.id));
  });

  /** "Send test": checks that the bot can still post (outbound only). */
  r.post("/:id/telegram/test", requireOrgAdmin, async (c) => {
    const app = await findOrgApp(db, c.get("org").id, c.req.param("id"));
    const { connection, token } = await connectionOf(app.id);
    try {
      await telegram.sendMessage(token, connection.chatId, `🔔 Test from <b>${escapeHtml(app.name)}</b>: notifications reach this chat.`);
    } catch (err) {
      await db.update(telegramConnections).set({ issue: refusal(err), issueAt: new Date() }).where(eq(telegramConnections.appId, app.id));
      throw new ApiError(422, "telegram_chat_unavailable", `Telegram refused the test: ${refusal(err)}`);
    }
    await db.update(telegramConnections).set({ issue: null, issueAt: null }).where(eq(telegramConnections.appId, app.id));
    return c.json(await settings(app.id));
  });

  /** Disconnects the app; a bot no other app uses has its webhook removed and its token forgotten. */
  r.delete("/:id/telegram", requireOrgAdmin, async (c) => {
    const org = c.get("org");
    const app = await findOrgApp(db, org.id, c.req.param("id"));
    const { bot, token } = await connectionOf(app.id);
    await db.delete(telegramConnections).where(eq(telegramConnections.appId, app.id));
    const [others] = await db.select({ n: count() }).from(telegramConnections).where(eq(telegramConnections.botId, bot.id));
    if (others!.n === 0) {
      await telegram.deleteWebhook(token).catch(() => {});
      await db.delete(telegramBots).where(eq(telegramBots.id, bot.id));
    }
    await audit(org.id, c.get("user").id, "telegram.disconnected", app.id);
    return c.body(null, 204);
  });

  return r;
}

/**
 * Telegram's updates for one bot, at /webhooks/telegram/:botId, checked against the secret token set with the
 * webhook. A team member's Reply to one of the bot's posts (or any message in a customer's topic) becomes a
 * team reply in the app; everything else is ignored. Always 200 once authenticated, so Telegram doesn't retry
 * what we chose to ignore.
 */
export function telegramWebhookRoutes(deps: Deps) {
  const { db } = deps;
  const r = new Hono();

  r.post("/:botId", async (c) => {
    const botId = c.req.param("botId");
    const [bot] = isUuid(botId) ? await db.select().from(telegramBots).where(eq(telegramBots.id, botId)) : [];
    const secret = c.req.header("x-telegram-bot-api-secret-token") ?? "";
    if (!bot || !timingSafeEqual(Buffer.from(sha256(secret)), Buffer.from(bot.webhookSecretHash))) {
      return c.json({ error: { code: "unauthorized", message: "Bad secret token" } }, 401);
    }
    const update = (await c.req.json().catch(() => null)) as TelegramUpdate | null;
    const message = update?.message;
    if (message) await handleMessage(deps, bot, message);
    return c.json({ ok: true });
  });

  return r;
}

type Bot = typeof telegramBots.$inferSelect;

async function handleMessage(deps: Deps, bot: Bot, message: TelegramMessage) {
  const { db } = deps;
  const chatId = message.chat.id;
  if (message.migrate_to_chat_id) return migrateChat(db, bot.id, chatId, message.migrate_to_chat_id);
  if (message.migrate_from_chat_id) return migrateChat(db, bot.id, message.migrate_from_chat_id, chatId);
  // bots, anonymous admins and channels, forwards and anything but text are ignored
  if (!message.from || message.from.is_bot || message.sender_chat || message.forward_origin || message.text === undefined) return;

  const conversationId = await routeTo(deps, bot, message);
  if (!conversationId) return;
  const [target] = await db
    .select({ conversation: conversations, connection: telegramConnections })
    .from(conversations)
    .innerJoin(apps, eq(apps.id, conversations.appId))
    .innerJoin(telegramConnections, eq(telegramConnections.appId, apps.id))
    .where(and(eq(conversations.id, conversationId), eq(telegramConnections.botId, bot.id), eq(telegramConnections.chatId, chatId)));
  // the app has since moved to another chat or bot
  if (!target) return;
  const { conversation } = target;

  const notice = (tx: Db | Tx, text: string) => enqueue(deps, tx, bot.id, chatId, { kind: "notice", appId: conversation.appId, chatId, replyTo: message.message_id, text });
  const text = message.text.trim();
  if (!text) return;
  if (text.length > TELEGRAM_REPLY_MAX) {
    return notice(db, `Not sent: replies can be up to ${TELEGRAM_REPLY_MAX.toLocaleString("en")} characters.`);
  }
  try {
    await deps.billing.requireCanReply(conversation.organizationId, conversation.id);
  } catch (err) {
    if (err instanceof ApiError && err.code === "subscription_inactive") return notice(db, "Not sent: this workspace needs an active subscription to reply.");
    throw err;
  }

  // one teammate: their reply. Several: a team reply (there's no linking Telegram users to accounts).
  const team = await db.select({ userId: members.userId }).from(members).where(eq(members.organizationId, conversation.organizationId)).limit(2);
  try {
    await appendAgentMessage(
      db,
      deps.jobs,
      {
        organizationId: conversation.organizationId,
        conversationId: conversation.id,
        authorUserId: team.length === 1 ? team[0]!.userId : null,
        clientId: null,
        text,
        attachmentIds: [],
        source: "telegram",
      },
      {
        after: async (tx, stored) => {
          // the key makes a redelivered update fail here, before anything is committed
          await tx.insert(telegramPosts).values({ botId: bot.id, chatId, telegramMessageId: message.message_id, conversationId: conversation.id, messageId: stored.id, kind: "reply" });
          await enqueue(deps, tx, bot.id, chatId, { kind: "react", appId: conversation.appId, chatId, telegramMessageId: message.message_id });
        },
      },
    );
  } catch (err) {
    if (isUniqueViolation(err, "telegram_posts_bot_id_chat_id_telegram_message_id_pk")) return;
    if (err instanceof ApiError && err.status === 404) return;
    throw err;
  }
}

/** The conversation a team message answers: the post it replies to, else the customer's topic it's in. */
async function routeTo(deps: Deps, bot: Bot, message: TelegramMessage) {
  const { db } = deps;
  const chatId = message.chat.id;
  if (message.reply_to_message) {
    const [post] = await db
      .select({ conversationId: telegramPosts.conversationId })
      .from(telegramPosts)
      .where(and(eq(telegramPosts.botId, bot.id), eq(telegramPosts.chatId, chatId), eq(telegramPosts.telegramMessageId, message.reply_to_message.message_id)));
    if (post) return post.conversationId;
  }
  if (message.is_topic_message && message.message_thread_id) {
    const [topic] = await db
      .select({ conversationId: telegramTopics.conversationId })
      .from(telegramTopics)
      .where(and(eq(telegramTopics.botId, bot.id), eq(telegramTopics.chatId, chatId), eq(telegramTopics.threadId, message.message_thread_id)));
    if (topic) return topic.conversationId;
  }
  return null;
}

/** Schedules a call into the chat's next slot, inside the caller's transaction when there is one. */
async function enqueue(deps: Deps, tx: Db | Tx, botId: string, chatId: number, job: TelegramJob) {
  const startAfter = await reserveSlot(tx, botId, chatId, deps.env.TELEGRAM_CHAT_INTERVAL_MS);
  await deps.jobs.telegramSend(tx, job, startAfter);
}
