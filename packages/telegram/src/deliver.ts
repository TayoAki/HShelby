import { customerLabel } from "@hshelby/contracts";
import { decryptSecret, type Keyring } from "@hshelby/core";
import {
  apps,
  attachments,
  conversations,
  devices,
  messages,
  telegramBots,
  telegramChats,
  telegramConnections,
  telegramPosts,
  telegramTopics,
  users,
  type Db,
  type Tx,
} from "@hshelby/db";
import { and, count, desc, eq, sql } from "drizzle-orm";
import { TelegramError, type TelegramClient } from "./client";
import { escapeHtml, mirrorHtml, notificationHtml, topicName } from "./format";

/** A stored message to tell the team about: the API enqueues it in the message's own transaction. */
export const TEAM_NOTIFY_QUEUE = "team.notify";
export const TEAM_NOTIFY_QUEUE_OPTIONS = { retryLimit: 5, retryDelay: 5, retryBackoff: true, notify: true } as const;
export type TeamNotifyJob = { messageId: string };

/** One call to Telegram, scheduled into its chat's next free slot. */
export const TELEGRAM_QUEUE = "telegram.send";
export const TELEGRAM_QUEUE_OPTIONS = { retryLimit: 5, retryDelay: 5, retryBackoff: true, retryDelayMax: 300 } as const;
export type TelegramJob =
  | { kind: "notify"; messageId: string }
  | { kind: "mirror"; messageId: string }
  /** 👍 on the team's reply once it's saved (or "Reply sent." where reactions are off). */
  | { kind: "react"; appId: string; chatId: number; telegramMessageId: number }
  | { kind: "notice"; appId: string; chatId: number; replyTo: number; text: string };

/** Telegram allows about 20 messages a minute in a group: one every 3 seconds per chat. */
export const DEFAULT_CHAT_INTERVAL_MS = 3000;

export type TelegramDeps = { db: Db; telegram: TelegramClient; keyring: Keyring; intervalMs?: number };

const seconds = (ms: number) => sql`make_interval(secs => ${ms / 1000})`;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The chat's next send slot, at least `intervalMs` after the previous one (or now). Spreading a burst's jobs
 * over time keeps workers from piling up on one chat; `paced` makes the actual guarantee.
 */
export async function reserveSlot(db: Db | Tx, botId: string, chatId: number, intervalMs = DEFAULT_CHAT_INTERVAL_MS) {
  const [row] = await db
    .insert(telegramChats)
    .values({ botId, chatId, nextSlotAt: sql`now() + ${seconds(intervalMs)}` })
    .onConflictDoUpdate({
      target: [telegramChats.botId, telegramChats.chatId],
      set: { nextSlotAt: sql`greatest(${telegramChats.nextSlotAt}, now()) + ${seconds(intervalMs)}` },
    })
    .returning({ slot: sql<Date>`${telegramChats.nextSlotAt} - ${seconds(intervalMs)}`.mapWith((v: string | Date) => new Date(v)) });
  return row!.slot;
}

/**
 * Runs one send with the chat's row locked, after waiting out the interval since the chat's last send, so
 * sends to a chat are never closer than `intervalMs` however the jobs were scheduled or retried.
 */
async function paced<T>(db: Db, botId: string, chatId: number, intervalMs: number, send: (tx: Tx) => Promise<T>) {
  return db.transaction(async (tx) => {
    await tx.insert(telegramChats).values({ botId, chatId }).onConflictDoNothing();
    const [chat] = await tx
      .select()
      .from(telegramChats)
      .where(and(eq(telegramChats.botId, botId), eq(telegramChats.chatId, chatId)))
      .for("update");
    const wait = chat!.lastSentAt ? chat!.lastSentAt.getTime() + intervalMs - Date.now() : 0;
    if (wait > 0) await sleep(wait);
    try {
      return await send(tx);
    } finally {
      await tx.update(telegramChats).set({ lastSentAt: new Date() }).where(and(eq(telegramChats.botId, botId), eq(telegramChats.chatId, chatId)));
    }
  });
}

/** A group upgraded to a supergroup gets a new chat ID: follow it everywhere. */
export async function migrateChat(db: Db | Tx, botId: string, fromChatId: number, toChatId: number) {
  await db
    .update(telegramConnections)
    .set({ chatId: toChatId, chatType: "supergroup", updatedAt: new Date() })
    .where(and(eq(telegramConnections.botId, botId), eq(telegramConnections.chatId, fromChatId)));
  await db
    .update(telegramPosts)
    .set({ chatId: toChatId })
    .where(and(eq(telegramPosts.botId, botId), eq(telegramPosts.chatId, fromChatId)));
  await db
    .update(telegramTopics)
    .set({ chatId: toChatId })
    .where(and(eq(telegramTopics.botId, botId), eq(telegramTopics.chatId, fromChatId)));
  await db.delete(telegramChats).where(and(eq(telegramChats.botId, botId), eq(telegramChats.chatId, fromChatId)));
}

type Connection = typeof telegramConnections.$inferSelect;

async function connectionFor(db: Db | Tx, appId: string) {
  const [row] = await db
    .select({ connection: telegramConnections, tokenEnc: telegramBots.tokenEnc })
    .from(telegramConnections)
    .innerJoin(telegramBots, eq(telegramBots.id, telegramConnections.botId))
    .where(eq(telegramConnections.appId, appId));
  return row ?? null;
}

async function recordIssue(db: Db | Tx, appId: string, issue: string) {
  await db.update(telegramConnections).set({ issue, issueAt: new Date() }).where(eq(telegramConnections.appId, appId));
}

/**
 * What team.notify does with a stored message: a customer's message becomes a notification, and a reply
 * written anywhere but Telegram is mirrored. Null when the app has no active Telegram connection.
 */
export async function planNotify(db: Db, messageId: string) {
  const [row] = await db
    .select({ message: messages, appId: conversations.appId, connection: telegramConnections })
    .from(messages)
    .innerJoin(conversations, eq(conversations.id, messages.conversationId))
    .innerJoin(telegramConnections, eq(telegramConnections.appId, conversations.appId))
    .where(eq(messages.id, messageId));
  if (!row || row.connection.paused) return null;
  if (row.message.sender === "agent" && row.message.source === "telegram") return null;
  const job: TelegramJob = { kind: row.message.sender === "user" ? "notify" : "mirror", messageId };
  return { job, botId: row.connection.botId, chatId: row.connection.chatId };
}

/** team.notify: schedules the post for a stored message into its chat's next slot, if the app posts to Telegram. */
export async function scheduleNotify(
  db: Db,
  messageId: string,
  enqueue: (job: TelegramJob, startAfter: Date, singletonKey: string) => Promise<unknown>,
  intervalMs = DEFAULT_CHAT_INTERVAL_MS,
) {
  const plan = await planNotify(db, messageId);
  if (!plan) return "skipped" as const;
  const startAfter = await reserveSlot(db, plan.botId, plan.chatId, intervalMs);
  await enqueue(plan.job, startAfter, `${plan.job.kind}:${messageId}`);
  return plan.job.kind;
}

export type SendOutcome = "sent" | "skipped" | "chat_gone" | "refused" | { retryAfter: number };

/**
 * Performs one telegram.send job. Telegram's answers: a migrated group is followed and the send retried; a
 * deleted topic is recreated once; a chat the bot can't post in is recorded on the connection; a 429 comes
 * back as `retryAfter` (the caller reschedules); other temporary failures throw so the queue retries.
 */
export async function sendTelegramJob(deps: TelegramDeps, job: TelegramJob, { lastAttempt }: { lastAttempt: boolean }): Promise<SendOutcome> {
  const intervalMs = deps.intervalMs ?? DEFAULT_CHAT_INTERVAL_MS;
  const target = await resolveTarget(deps.db, job);
  if (!target) return "skipped";
  const { appId, connection, token } = target;

  for (let attempt = 0; attempt < 3; attempt++) {
    const chatId = attempt === 0 && "chatId" in job ? job.chatId : connection.chatId;
    try {
      return await paced(deps.db, connection.botId, chatId, intervalMs, (tx) => perform(deps, tx, job, { ...connection, chatId }, token));
    } catch (err) {
      if (!(err instanceof TelegramError)) throw err;
      if (err.migrateToChatId) {
        await migrateChat(deps.db, connection.botId, chatId, err.migrateToChatId);
        connection.chatId = err.migrateToChatId;
        continue;
      }
      if (err.isThreadGone && "messageId" in job) {
        // someone deleted the customer's topic: make a new one
        await forgetTopicOf(deps.db, connection, job.messageId);
        continue;
      }
      if (err.code === 429) {
        const retryAfter = err.retryAfter ?? 5;
        await deps.db
          .update(telegramChats)
          .set({ nextSlotAt: sql`greatest(${telegramChats.nextSlotAt}, now() + ${seconds(retryAfter * 1000)})` })
          .where(and(eq(telegramChats.botId, connection.botId), eq(telegramChats.chatId, chatId)));
        return { retryAfter };
      }
      if (err.isChatGone) {
        await recordIssue(deps.db, appId, err.description);
        return "chat_gone";
      }
      if (err.isRetryable) {
        if (lastAttempt) await recordIssue(deps.db, appId, err.description);
        throw err;
      }
      await recordIssue(deps.db, appId, err.description);
      return "refused";
    }
  }
  return "refused";
}

/** The app and connection a job belongs to, if it still has one that isn't paused. */
async function resolveTarget(db: Db, job: TelegramJob) {
  let appId: string;
  if ("messageId" in job) {
    const [row] = await db
      .select({ appId: conversations.appId })
      .from(messages)
      .innerJoin(conversations, eq(conversations.id, messages.conversationId))
      .where(eq(messages.id, job.messageId));
    if (!row) return null;
    appId = row.appId;
  } else {
    appId = job.appId;
  }
  const found = await connectionFor(db, appId);
  if (!found || (found.connection.paused && (job.kind === "notify" || job.kind === "mirror"))) return null;
  return { appId, connection: found.connection, token: found.tokenEnc };
}

async function forgetTopicOf(db: Db, connection: Connection, messageId: string) {
  const [row] = await db.select({ conversationId: messages.conversationId }).from(messages).where(eq(messages.id, messageId));
  if (!row) return;
  await db
    .delete(telegramTopics)
    .where(and(eq(telegramTopics.botId, connection.botId), eq(telegramTopics.conversationId, row.conversationId)));
}

async function perform(deps: TelegramDeps, tx: Tx, job: TelegramJob, connection: Connection, tokenEnc: string): Promise<SendOutcome> {
  const token = decryptSecret(tokenEnc, deps.keyring);
  const { telegram } = deps;
  const chatId = connection.chatId;

  if (job.kind === "react") {
    try {
      await telegram.setMessageReaction(token, chatId, job.telegramMessageId, "👍");
    } catch (err) {
      // reactions turned off in the group (or not allowed for bots there): say it in words
      if (!(err instanceof TelegramError) || err.code !== 400 || err.isChatGone) throw err;
      await telegram.sendMessage(token, chatId, "Reply sent.", { replyTo: job.telegramMessageId, silent: true });
    }
    return "sent";
  }
  if (job.kind === "notice") {
    await telegram.sendMessage(token, chatId, escapeHtml(job.text), { replyTo: job.replyTo, silent: true });
    return "sent";
  }

  const [row] = await tx
    .select({ message: messages, conversation: conversations, device: devices, appName: apps.name, authorName: users.name })
    .from(messages)
    .innerJoin(conversations, eq(conversations.id, messages.conversationId))
    .innerJoin(devices, eq(devices.id, conversations.deviceId))
    .innerJoin(apps, eq(apps.id, conversations.appId))
    .leftJoin(users, eq(users.id, messages.authorUserId))
    .where(eq(messages.id, job.messageId));
  if (!row) return "skipped";
  const [photos] = await tx.select({ n: count() }).from(attachments).where(eq(attachments.messageId, row.message.id));
  const content = { text: row.message.text, kind: row.message.kind, card: row.message.card, photos: photos!.n };
  const userLabel = customerLabel({ ...row.device, userId: row.device.userIdExt });
  const threadId = connection.topics ? await ensureTopic(deps, tx, token, connection, row.conversation.id, topicName(row.appName, userLabel)) : undefined;

  if (job.kind === "notify") {
    const html = notificationHtml({ ...content, appName: row.appName, userLabel, verified: row.device.verified });
    const sent = await telegram.sendMessage(token, chatId, html, { threadId });
    await recordPost(tx, connection, sent.message_id, row.conversation.id, row.message.id, "notification");
    return "sent";
  }

  // mirror: silently, as a reply under the customer's latest notification
  const [latest] = await tx
    .select({ telegramMessageId: telegramPosts.telegramMessageId })
    .from(telegramPosts)
    .where(
      and(
        eq(telegramPosts.conversationId, row.conversation.id),
        eq(telegramPosts.botId, connection.botId),
        eq(telegramPosts.chatId, chatId),
        eq(telegramPosts.kind, "notification"),
      ),
    )
    .orderBy(desc(telegramPosts.createdAt))
    .limit(1);
  const senderName =
    row.message.source === "ai" ? "AI" : row.message.source === "automation" ? "Automation" : (row.authorName?.split(" ")[0] ?? "Team");
  const sent = await telegram.sendMessage(token, chatId, mirrorHtml({ ...content, senderName }), {
    threadId,
    replyTo: latest?.telegramMessageId,
    silent: true,
  });
  await recordPost(tx, connection, sent.message_id, row.conversation.id, row.message.id, "mirror");
  return "sent";
}

async function recordPost(tx: Tx, connection: Connection, telegramMessageId: number, conversationId: string, messageId: string, kind: "notification" | "mirror") {
  await tx
    .insert(telegramPosts)
    .values({ botId: connection.botId, chatId: connection.chatId, telegramMessageId, conversationId, messageId, kind })
    .onConflictDoNothing();
}

/**
 * The customer's forum topic, created on their first message (and again if someone deleted it) and renamed
 * when their name changes. Without the rights to manage topics, posts go to the main chat and the connection
 * says why. Writes go outside the send's transaction: a topic Telegram created stays known even if the send
 * after it fails.
 */
async function ensureTopic(deps: TelegramDeps, tx: Tx, token: string, connection: Connection, conversationId: string, name: string) {
  const { db } = deps;
  const [topic] = await tx
    .select()
    .from(telegramTopics)
    .where(and(eq(telegramTopics.botId, connection.botId), eq(telegramTopics.chatId, connection.chatId), eq(telegramTopics.conversationId, conversationId)));
  if (topic) {
    if (topic.name !== name) {
      await deps.telegram.editForumTopic(token, connection.chatId, topic.threadId, name).catch(() => {});
      await db
        .update(telegramTopics)
        .set({ name })
        .where(and(eq(telegramTopics.botId, connection.botId), eq(telegramTopics.chatId, connection.chatId), eq(telegramTopics.conversationId, conversationId)));
    }
    return topic.threadId;
  }
  try {
    const created = await deps.telegram.createForumTopic(token, connection.chatId, name);
    await db.insert(telegramTopics).values({ botId: connection.botId, chatId: connection.chatId, conversationId, threadId: created.message_thread_id, name });
    return created.message_thread_id;
  } catch (err) {
    if (!(err instanceof TelegramError) || err.isRetryable) throw err;
    await recordIssue(db, connection.appId, `Topics unavailable (${err.description}); posting in the main chat`);
    return undefined;
  }
}
