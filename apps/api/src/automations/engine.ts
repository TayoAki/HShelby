import {
  isPaywallAvailable,
  type AutomationDefinition,
  type AutomationStep,
  type RunReason,
  type RunStatus,
  type StoredCard,
} from "@hshelby/contracts";
import { uuidv7 } from "@hshelby/core";
import { apps, automationRuns, automations, conversations, devices, messages, type Db } from "@hshelby/db";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { markReviewAsked } from "../cards";
import type { Deps } from "../context";
import { appendAgentMessage } from "../messaging";
import { waitUntil } from "./time";

/*
 * The automation run engine. An event for a person starts (or resumes) a run of every enabled automation that
 * listens for it: the audience and ongoing-conversation checks first, then the wait, then the steps in order.
 * Offers and ratings are checked before anything is sent; if one can't go out, the whole run is held and tried
 * again at the person's next event, so nobody gets a message that introduces nothing. Steps after a wait are
 * re-checked first: a reply, an audience change or a gone offer ends the run.
 */

export type EngineDeps = Pick<Deps, "db" | "jobs" | "logger">;

type AutomationRow = typeof automations.$inferSelect;
type RunRow = typeof automationRuns.$inferSelect;
type DeviceRow = typeof devices.$inferSelect;

const DAY = 24 * 60 * 60 * 1000;

/** Whether the device's person is in the automation's audience: paying segment and metadata rules. */
export function inAudience(audience: AutomationDefinition["audience"], device: DeviceRow) {
  const metadataStatus = device.metadata.subscription_status?.toLowerCase();
  const paying =
    device.subscription?.paying === true ||
    device.reportedPaying === true ||
    (metadataStatus !== undefined && ["active", "trial", "trialing", "paying", "subscribed"].includes(metadataStatus));
  if (audience.segment === "paying" && !paying) return false;
  if (audience.segment === "not_paying" && paying) return false;
  return audience.rules.every((rule) => {
    const value = device.metadata[rule.key];
    switch (rule.op) {
      case "exists":
        return value !== undefined;
      case "not_exists":
        return value === undefined;
      case "equals":
        return value === rule.value;
      case "not_equals":
        return value !== rule.value;
      case "contains":
        return value !== undefined && value.toLowerCase().includes((rule.value ?? "").toLowerCase());
    }
  });
}

async function loadContext(db: Db, deviceId: string) {
  const [row] = await db
    .select({ device: devices, app: apps })
    .from(devices)
    .innerJoin(apps, and(eq(apps.id, devices.appId), isNull(apps.deletedAt)))
    .where(eq(devices.id, deviceId));
  if (!row) return null;
  const [conversation] = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.deviceId, deviceId), isNull(conversations.supersededAt)));
  return { ...row, conversation: conversation ?? null };
}
type Context = NonNullable<Awaited<ReturnType<typeof loadContext>>>;

/** Why the offers and ratings among `steps` can't go to this person right now, if they can't. */
function blockedSend(steps: AutomationStep[], ctx: Context): RunReason | null {
  for (const step of steps) {
    if (step.type === "offer" && !isPaywallAvailable(ctx.device.availablePaywalls, step.paywallId)) return "offer_unavailable";
    if (step.type === "rating" && !ctx.app.appStoreId) return "no_app_store_id";
    if (step.type === "rating" && ctx.device.reviewAskedAt) return "already_asked";
  }
  return null;
}

async function setRun(db: Db, id: string, values: Partial<typeof automationRuns.$inferInsert>) {
  await db.update(automationRuns).set({ ...values, updatedAt: new Date() }).where(eq(automationRuns.id, id));
}

const finish = (db: Db, run: RunRow, status: RunStatus, reason: RunReason | null = null) =>
  setRun(db, run.id, { status, reason, nextAt: null });

export type EventOutcome = { sent: boolean; openChat: boolean };

/**
 * Something happened for these devices (an event the app tracked, or a subscription event): starts runs of the
 * enabled automations listening for it, or retries runs held for them. Sending happens right here for runs
 * without a wait, so `/v1/track` can tell the app to open the chat.
 */
export async function onEvent(deps: EngineDeps, input: { appId: string; deviceIds: string[]; event: string; now?: Date }): Promise<EventOutcome> {
  const list = await deps.db
    .select()
    .from(automations)
    .where(and(eq(automations.appId, input.appId), eq(automations.enabled, true), eq(automations.triggerEvent, input.event)));
  const outcome: EventOutcome = { sent: false, openChat: false };
  for (const deviceId of input.deviceIds) {
    for (const automation of list) {
      const result = await startOrResume(deps, automation, deviceId, input.now ?? new Date());
      outcome.sent ||= result.sent;
      outcome.openChat ||= result.openChat;
    }
  }
  return outcome;
}

async function startOrResume(deps: EngineDeps, automation: AutomationRow, deviceId: string, now: Date): Promise<EventOutcome> {
  const { db } = deps;
  const def = automation.definition;
  // one decision at a time per automation and person, so simultaneous events can't start two runs
  const run = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${automation.id}:${deviceId}`}))`);
    const runs = await tx
      .select()
      .from(automationRuns)
      .where(and(eq(automationRuns.automationId, automation.id), eq(automationRuns.deviceId, deviceId)))
      .orderBy(desc(automationRuns.createdAt));
    const held = runs.find((r) => r.status === "held");
    if (held) {
      await tx.update(automationRuns).set({ status: "running", reason: null, updatedAt: new Date() }).where(eq(automationRuns.id, held.id));
      return { ...held, status: "running" as const, resumed: true };
    }
    const active = runs.some((r) => r.status === "scheduled" || r.status === "running");
    // once: never again after a run that got anywhere; every: after the previous run completes
    const ranBefore = runs.some((r) => r.status === "done" || r.status === "ended" || r.status === "scheduled" || r.status === "running");
    if (active || (def.trigger.frequency === "once" && ranBefore)) return null;
    const [created] = await tx.insert(automationRuns).values({ id: uuidv7(), automationId: automation.id, deviceId, status: "running" }).returning();
    return { ...created!, resumed: false };
  });
  if (!run) return { sent: false, openChat: false };

  const ctx = await loadContext(db, deviceId);
  if (!ctx) {
    await finish(db, run, "skipped", "signed_out");
    return { sent: false, openChat: false };
  }
  if (ctx.device.blocked || ctx.device.signedOutAt) {
    await finish(db, run, "skipped", ctx.device.blocked ? "blocked" : "signed_out");
    return { sent: false, openChat: false };
  }
  if (!inAudience(def.audience, ctx.device)) {
    await finish(db, run, "skipped", "audience");
    return { sent: false, openChat: false };
  }
  // someone who's talking with the team isn't interrupted; a later event catches them
  const recent = ctx.conversation && now.getTime() - ctx.conversation.lastMessageAt.getTime() < DAY;
  if (!def.audience.duringConversation && recent && ctx.conversation!.userEngaged) {
    await finish(db, run, "skipped", "ongoing_conversation");
    return { sent: false, openChat: false };
  }
  if (def.wait.type !== "immediate" && !run.resumed) {
    const nextAt = waitUntil(def.wait, ctx.device.timezone, now);
    await setRun(db, run.id, { status: "scheduled", nextAt });
    await deps.jobs.automationStep(db, run.id, nextAt);
    return { sent: false, openChat: false };
  }
  return executeRun(deps, run.id, now);
}

/**
 * Sends the run's next steps, up to its next wait or the end. Runs both for runs without a wait and from the
 * `automation.step` job when a wait is over. Each message and the run's move past it commit together.
 */
export async function executeRun(deps: EngineDeps, runId: string, now = new Date()): Promise<EventOutcome> {
  const { db } = deps;
  const [row] = await db
    .select({ run: automationRuns, automation: automations })
    .from(automationRuns)
    .innerJoin(automations, eq(automations.id, automationRuns.automationId))
    .where(eq(automationRuns.id, runId));
  if (!row || (row.run.status !== "running" && row.run.status !== "scheduled")) return { sent: false, openChat: false };
  const { run, automation } = row;
  const def = automation.definition;
  const ctx = await loadContext(db, run.deviceId);
  if (!automation.enabled) {
    await finish(db, run, "ended", "disabled");
    return { sent: false, openChat: false };
  }
  if (!ctx || ctx.device.blocked || ctx.device.signedOutAt) {
    await finish(db, run, "ended", ctx?.device.blocked ? "blocked" : "signed_out");
    return { sent: false, openChat: false };
  }

  const remaining = def.steps.slice(run.stepIndex);
  const nextWait = remaining.findIndex((s) => s.type === "wait");
  const upcoming = nextWait === -1 ? remaining : remaining.slice(0, nextWait);
  if (run.firstSentAt) {
    // a follow-up after a wait: only if nothing changed
    const [reply] = await db
      .select({ id: messages.id })
      .from(messages)
      .innerJoin(conversations, eq(conversations.id, messages.conversationId))
      .where(and(eq(conversations.deviceId, run.deviceId), eq(messages.sender, "user"), gt(messages.createdAt, run.firstSentAt)))
      .limit(1);
    if (reply) return endWith(db, run, "replied");
    if (!inAudience(def.audience, ctx.device)) return endWith(db, run, "audience");
    const blocked = blockedSend(upcoming, ctx);
    if (blocked) return endWith(db, run, blocked);
  } else {
    if (!inAudience(def.audience, ctx.device)) return endWith(db, run, "audience");
    // before anything is sent, every offer and rating of the run must be able to go
    const blocked = blockedSend(def.steps, ctx);
    if (blocked) {
      await setRun(db, run.id, { status: "held", reason: blocked, nextAt: null });
      return { sent: false, openChat: false };
    }
  }

  let sent = false;
  let openChat = run.openChat;
  for (let i = run.stepIndex; i < def.steps.length; i++) {
    const step = def.steps[i]!;
    if (step.type === "wait") {
      const nextAt = new Date(now.getTime() + step.minutes * 60_000);
      await setRun(db, run.id, { status: "scheduled", stepIndex: i + 1, nextAt, openChat });
      await deps.jobs.automationStep(db, run.id, nextAt);
      return { sent, openChat: sent && openChat };
    }
    if (step.type === "open_chat") {
      openChat = true;
      await setRun(db, run.id, { stepIndex: i + 1, openChat });
      continue;
    }
    const delivered = await sendStep(deps, ctx, automation, run.id, i, step);
    if (!delivered) return { sent, openChat: false };
    sent = true;
  }
  await setRun(db, run.id, { status: "done", nextAt: null, openChat });
  return { sent, openChat: sent && openChat };
}

async function endWith(db: Db, run: RunRow, reason: RunReason): Promise<EventOutcome> {
  await finish(db, run, "ended", reason);
  return { sent: false, openChat: false };
}

/** The person's conversation, started by the automation if they don't have one (hidden from the inbox until they reply). */
async function conversationFor(db: Db, ctx: Context) {
  if (ctx.conversation) return ctx.conversation;
  await db
    .insert(conversations)
    .values({ id: uuidv7(), organizationId: ctx.app.organizationId, appId: ctx.app.id, deviceId: ctx.device.id, userEngaged: false })
    .onConflictDoNothing({ target: conversations.deviceId, where: sql`superseded_at is null` });
  const [conversation] = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.deviceId, ctx.device.id), isNull(conversations.supersededAt)));
  ctx.conversation = conversation!;
  return conversation!;
}

/**
 * One message, offer or rating. The run moves past the step in the message's transaction, guarded by the step
 * index, so a retried job (or a second worker) can't send it twice.
 */
async function sendStep(
  deps: EngineDeps,
  ctx: Context,
  automation: AutomationRow,
  runId: string,
  index: number,
  step: Extract<AutomationStep, { type: "message" | "offer" | "rating" }>,
) {
  const def = automation.definition;
  const conversation = await conversationFor(deps.db, ctx);
  let card: StoredCard | undefined;
  let text: string;
  if (step.type === "offer") {
    const paywall = ctx.device.availablePaywalls.find((p) => p.id === step.paywallId)!;
    card = { type: "paywall", paywallId: paywall.id, paywallTitle: paywall.title, buttonLabel: step.buttonLabel };
    text = step.text;
  } else if (step.type === "rating") {
    card = { type: "review", scenario: null, buttonLabel: step.buttonLabel };
    text = step.text.replaceAll("{app}", ctx.app.name);
  } else {
    text = step.text;
  }
  let moved = false;
  await appendAgentMessage(
    deps.db,
    deps.jobs,
    {
      organizationId: ctx.app.organizationId,
      conversationId: conversation.id,
      authorUserId: automation.senderUserId,
      clientId: null,
      text,
      attachmentIds: [],
      card,
      source: "automation",
      // every offer pushes, whatever the automation's push setting
      push: def.withPush || step.type === "offer",
    },
    {
      after: async (tx, message) => {
        const [updated] = await tx
          .update(automationRuns)
          .set({
            stepIndex: index + 1,
            messageIds: sql`array_append(${automationRuns.messageIds}, ${message.id}::uuid)`,
            firstSentAt: sql`coalesce(${automationRuns.firstSentAt}, now())`,
            updatedAt: new Date(),
          })
          .where(and(eq(automationRuns.id, runId), eq(automationRuns.stepIndex, index)))
          .returning({ id: automationRuns.id });
        if (!updated) throw new StepAlreadySent();
        if (step.type === "rating") await markReviewAsked(tx, ctx.device.id);
        moved = true;
      },
    },
  ).catch((err: unknown) => {
    if (!(err instanceof StepAlreadySent)) throw err;
  });
  return moved;
}

class StepAlreadySent extends Error {}
