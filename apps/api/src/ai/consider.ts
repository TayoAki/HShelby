import Anthropic from "@anthropic-ai/sdk";
import { DEFAULT_AI_SETTINGS, type AiAction, type AiOutcome, type AiSettings, type AiUsage, type StoredCard } from "@hshelby/contracts";
import { uuidv7 } from "@hshelby/core";
import { aiRuns, aiSettings, apps, attachments, conversations, devices, messages, users, type Db, type Tx } from "@hshelby/db";
import { and, count, desc, eq, gt, gte, inArray, lt, sql } from "drizzle-orm";
import { guardRepeat, markReviewAsked } from "../cards";
import type { Deps } from "../context";
import { ApiError } from "../errors";
import type { AiConsiderJob } from "../jobs";
import { appendAgentMessage, type AppendHooks, type ConversationRow } from "../messaging";
import { publishLive } from "../realtime/events";
import { Halted, Refused, runTurn, type Executor, type TurnResult } from "./assistant";
import { offersFor, reviewUnavailable, systemPrompt, turnPrompt, TRANSCRIPT_MESSAGES, type PersonFacts, type TranscriptMessage } from "./prompt";

/*
 * The ai.consider job (phase B11): a few seconds after a person's message, the AI answers it, unless the
 * conversation moved on. Every message the AI sends re-checks, inside the send's transaction with the
 * conversation row locked, that the AI still has the conversation and nobody answered first: a teammate's
 * reply (which pauses the AI) and the AI's message can't both go out as answers to the same message.
 */

/** The AI's messages per conversation per day; past it, the conversation goes to the team. */
export const AI_DAILY_LIMIT = 30;
const TYPING_REFRESH_MS = 4000;

export async function getAiSettings(db: Db | Tx, appId: string): Promise<AiSettings> {
  const [row] = await db.select().from(aiSettings).where(eq(aiSettings.appId, appId));
  if (!row) return { ...DEFAULT_AI_SETTINGS, updatedAt: null };
  const { enabled, name, instructions, docs, allowOffers, allowReviews } = row;
  return { enabled, name, instructions, docs, allowOffers, allowReviews, updatedAt: row.updatedAt.toISOString() };
}

/** The conversation's latest messages, oldest first, up to `uptoSeq`. */
export async function transcriptOf(db: Db, conversationId: string, uptoSeq?: number): Promise<TranscriptMessage[]> {
  const rows = await db
    .select({ message: messages, authorName: users.name })
    .from(messages)
    .leftJoin(users, eq(users.id, messages.authorUserId))
    .where(and(eq(messages.conversationId, conversationId), uptoSeq === undefined ? undefined : sql`${messages.seq} <= ${uptoSeq}`))
    .orderBy(desc(messages.seq))
    .limit(TRANSCRIPT_MESSAGES);
  const ids = rows.map((r) => r.message.id);
  const photos = ids.length
    ? await db
        .select({ messageId: attachments.messageId, n: count() })
        .from(attachments)
        .where(inArray(attachments.messageId, ids))
        .groupBy(attachments.messageId)
    : [];
  const photosOf = new Map(photos.map((p) => [p.messageId, p.n]));
  return rows.reverse().map(({ message: m, authorName }) => ({
    sender: m.sender,
    source: m.source,
    authorName,
    text: m.text,
    kind: m.kind,
    card: m.card,
    actionClickedAt: m.actionClickedAt,
    photos: photosOf.get(m.id) ?? 0,
    createdAt: m.createdAt,
  }));
}

export const personFacts = (d: typeof devices.$inferSelect): PersonFacts => ({
  name: d.name,
  email: d.email,
  userId: d.userIdExt,
  verified: d.verified,
  locale: d.locale,
  timezone: d.timezone,
  model: d.model,
  osVersion: d.osVersion,
  appVersion: d.appVersion,
  subscription: d.subscription ?? null,
  availablePaywalls: d.availablePaywalls,
  reviewAskedAt: d.reviewAskedAt,
});

const asRefused = (err: unknown): never => {
  if (err instanceof ApiError && err.code === "card_repeat_unconfirmed") {
    throw new Refused("The last one of these got no reply from the person. Don't send another.");
  }
  throw err;
};

type Target = { organizationId: string; conversationId: string; deviceId: string; userSeq: number; userMessageId: string };

/** Sends the AI's choices for real, each guarded so it only goes out while the AI still has the conversation. */
export function liveExecutor(deps: Deps, t: Target): Executor {
  const { db } = deps;
  const sentIds: string[] = [];

  /** With the conversation row locked: has anything happened since the person's message, apart from this turn? */
  async function guard(tx: Tx, conversation: ConversationRow, uptoSeq: number) {
    if (conversation.aiState !== "active") {
      throw new Halted(conversation.aiState === "paused" ? "a teammate replied" : "the conversation was handed over");
    }
    const later = await tx
      .select({ id: messages.id, sender: messages.sender })
      .from(messages)
      .where(and(eq(messages.conversationId, conversation.id), gt(messages.seq, t.userSeq), lt(messages.seq, uptoSeq)));
    if (later.some((m) => m.sender === "user")) throw new Halted("the person wrote again");
    if (later.some((m) => !sentIds.includes(m.id))) throw new Halted("someone answered first");
  }

  async function handOver(tx: Tx, reason: string) {
    await tx
      .update(conversations)
      .set({ aiState: "handed_over", aiStateReason: reason, aiStateAt: new Date(), updatedAt: new Date() })
      .where(eq(conversations.id, t.conversationId));
    await deps.jobs.notifyHandover(tx, t.userMessageId, reason);
    await publishLive(tx, { type: "conversation", organizationId: t.organizationId, conversationId: t.conversationId, deviceId: t.deviceId });
  }

  async function send(text: string, card?: StoredCard, hooks: AppendHooks = {}) {
    const { message } = await appendAgentMessage(
      db,
      deps.jobs,
      { organizationId: t.organizationId, conversationId: t.conversationId, authorUserId: null, clientId: null, text, attachmentIds: [], card, source: "ai" },
      {
        // the new message's seq is conversation.lastSeq: everything before it counts
        before: async (tx, conversation) => {
          await guard(tx, conversation, conversation.lastSeq);
          await hooks.before?.(tx, conversation);
        },
        after: hooks.after,
      },
    );
    sentIds.push(message.id);
  }

  return {
    reply: (text) => send(text),
    offer: (paywall, text) =>
      send(text, { type: "paywall", paywallId: paywall.id, paywallTitle: paywall.title, buttonLabel: null }, {
        before: (tx, conversation) => guardRepeat(tx, conversation, "paywall", false).catch(asRefused),
      }),
    review: (text) =>
      send(text, { type: "review", scenario: "after_helping", buttonLabel: null }, {
        before: (tx, conversation) => guardRepeat(tx, conversation, "review", false).catch(asRefused),
        after: (tx, _message, conversation) => markReviewAsked(tx, conversation.deviceId),
      }),
    handover: async (reason, message) => {
      if (message) {
        await send(message, undefined, { after: (tx) => handOver(tx, reason) });
        return;
      }
      await db.transaction(async (tx) => {
        const [conversation] = await tx.select().from(conversations).where(eq(conversations.id, t.conversationId)).for("update");
        if (!conversation) throw new Halted("the conversation is gone");
        await guard(tx, conversation, conversation.lastSeq + 1);
        await handOver(tx, reason);
      });
    },
  };
}

const outcomeOf = (actions: AiAction[], fallbackOutcome: AiOutcome): AiOutcome =>
  actions.some((a) => a.type === "handover")
    ? "handed_over"
    : actions.some((a) => a.type === "offer")
      ? "sent_offer"
      : actions.some((a) => a.type === "review")
        ? "asked_review"
        : actions.length > 0
          ? "replied"
          : fallbackOutcome;

const EMPTY_USAGE: AiUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };

/**
 * Answers the person's message if it's still the latest and nobody answered it. Returns what happened, for the
 * job's output. A failing database throws, so pg-boss retries (the guard keeps a retry from answering twice);
 * a failing model hands the conversation to the team.
 */
export async function considerMessage(deps: Deps, job: AiConsiderJob): Promise<string> {
  const { db } = deps;
  const [row] = await db
    .select({ message: messages, conversation: conversations, device: devices, app: apps })
    .from(messages)
    .innerJoin(conversations, eq(conversations.id, messages.conversationId))
    .innerJoin(devices, eq(devices.id, conversations.deviceId))
    .innerJoin(apps, eq(apps.id, conversations.appId))
    .where(and(eq(messages.id, job.messageId), eq(messages.conversationId, job.conversationId)));
  if (!row || row.app.deletedAt || row.conversation.supersededAt || row.message.sender !== "user") return "gone";
  if (row.conversation.aiState !== "active") return row.conversation.aiState;
  if (row.device.blocked) return "blocked";

  const [latest] = await db
    .select({ seq: messages.seq, sender: messages.sender })
    .from(messages)
    .where(eq(messages.conversationId, row.conversation.id))
    .orderBy(desc(messages.seq))
    .limit(1);
  // a newer message from the person has its own job; anything else means someone answered
  if (latest && latest.seq !== row.message.seq) return latest.sender === "user" ? "superseded" : "answered";

  const settings = await getAiSettings(db, row.app.id);
  if (!settings.enabled) return "disabled";
  if (!deps.anthropic) return "unavailable";
  try {
    await deps.billing.requireCanReply(row.conversation.organizationId, row.conversation.id);
  } catch (err) {
    if (err instanceof ApiError && err.code === "subscription_inactive") return "inactive";
    throw err;
  }

  const target: Target = {
    organizationId: row.conversation.organizationId,
    conversationId: row.conversation.id,
    deviceId: row.device.id,
    userSeq: row.message.seq,
    userMessageId: row.message.id,
  };
  const executor = liveExecutor(deps, target);
  const record = (outcome: AiOutcome, result: Pick<TurnResult, "actions" | "notes" | "fallback" | "usage">, latencyMs: number, error: string | null = null) =>
    db.insert(aiRuns).values({
      id: uuidv7(),
      appId: row.app.id,
      conversationId: row.conversation.id,
      messageId: row.message.id,
      outcome,
      actions: result.actions,
      notes: result.notes,
      error,
      fallback: result.fallback,
      ...result.usage,
      latencyMs,
    });
  /** Hands over without a model call; false if the conversation moved on first. */
  const handOver = async (reason: string) => {
    try {
      await executor.handover(reason, "");
      return true;
    } catch (err) {
      if (err instanceof Halted) return false;
      throw err;
    }
  };

  const [today] = await db
    .select({ n: count() })
    .from(messages)
    .where(and(eq(messages.conversationId, row.conversation.id), eq(messages.source, "ai"), gte(messages.createdAt, sql`now() - interval '1 day'`)));
  if (today!.n >= AI_DAILY_LIMIT) {
    const reason = `The AI has sent ${today!.n} messages here in the last day; a teammate should take over.`;
    const handed = await handOver(reason);
    await record(handed ? "handed_over" : "stopped", { actions: handed ? [{ type: "handover", reason, message: "" }] : [], notes: [], fallback: false, usage: EMPTY_USAGE }, 0);
    return "limit";
  }

  const person = personFacts(row.device);
  const transcript = await transcriptOf(db, row.conversation.id, row.message.seq);
  const stopTyping = showTyping(deps, target, settings.name);
  const started = Date.now();
  let result: TurnResult;
  try {
    result = await runTurn(
      deps.anthropic,
      {
        system: systemPrompt(row.app.name, settings),
        prompt: turnPrompt(row.app, settings, person, transcript),
        allowOffers: settings.allowOffers,
        allowReviews: settings.allowReviews,
        offers: offersFor(person),
        reviewUnavailable: reviewUnavailable(row.app, person),
      },
      executor,
    );
  } catch (err) {
    // the model's API failed after the SDK's retries: nobody should wait on it
    if (!(err instanceof Anthropic.APIError)) throw err;
    deps.logger.warn({ err, conversationId: row.conversation.id }, "ai model call failed");
    const error = `${err.status ?? "connection"}: ${err.message}`.slice(0, 500);
    const reason = "The AI couldn't answer (the model service failed); please reply.";
    const handed = await handOver(reason);
    await record("failed", { actions: handed ? [{ type: "handover", reason, message: "" }] : [], notes: [], fallback: false, usage: EMPTY_USAGE }, Date.now() - started, error);
    return "failed";
  } finally {
    stopTyping();
  }
  const latencyMs = Date.now() - started;

  if (result.halted) {
    await record(outcomeOf(result.actions, "stopped"), result, latencyMs);
    return "stopped";
  }
  if (result.actions.length === 0) {
    // declined by the model and its fallback, or no tool chosen: a teammate answers instead
    const reason = result.refused ? "The AI declined to answer this one." : "The AI couldn't decide how to answer.";
    const handed = await handOver(reason);
    const actions: AiAction[] = handed ? [{ type: "handover", reason, message: "" }] : [];
    await record(handed ? "handed_over" : "stopped", { ...result, actions, notes: [...result.notes, reason] }, latencyMs);
    return handed ? "handed_over" : "stopped";
  }
  const outcome = outcomeOf(result.actions, "replied");
  await record(outcome, result, latencyMs);
  return outcome;
}

/** "Assistant is typing…" in the app while the model thinks, refreshed before the indicator times out. */
function showTyping(deps: Deps, t: Target, name: string) {
  const publish = () =>
    publishLive(deps.db, {
      type: "typing",
      organizationId: t.organizationId,
      conversationId: t.conversationId,
      deviceId: t.deviceId,
      sender: "agent",
      name,
      userId: null,
    }).catch((err: unknown) => deps.logger.warn({ err }, "typing publish failed"));
  void publish();
  const timer = setInterval(() => void publish(), TYPING_REFRESH_MS);
  return () => clearInterval(timer);
}
