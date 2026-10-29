import {
  appStoreReviewUrl,
  DEFAULT_REVIEW_TEMPLATES,
  isPaywallAvailable,
  type CardSettings,
  type CardStats,
  type InboxCard,
  type ReportedPaywall,
  type SdkCard,
  SendCardInput,
  type StoredCard,
} from "@hshelby/contracts";
import { appPaywalls, cardSettings, conversations, devices, messages, users, type Db, type Tx } from "@hshelby/db";
import { and, desc, eq, gt, gte, inArray, sql } from "drizzle-orm";
import type { z } from "zod";
import { ApiError } from "./errors";
import type { ConversationRow } from "./messaging";

/* Review and offer cards (phase B7): what a card stores, how each side sees it, and the checks before one is sent. */

type CardInput = z.output<typeof SendCardInput>;

export const toSdkCard = (card: StoredCard | null, appStoreId: string | null): SdkCard | null => {
  if (!card) return null;
  return card.type === "review"
    ? { type: "review", url: appStoreReviewUrl(appStoreId), buttonLabel: card.buttonLabel }
    : { type: "paywall", paywallId: card.paywallId, buttonLabel: card.buttonLabel };
};

export const toInboxCard = (card: StoredCard | null, appStoreId: string | null): InboxCard | null => {
  if (!card) return null;
  return card.type === "review" ? { ...card, url: appStoreReviewUrl(appStoreId) } : card;
};

/**
 * Adds the device's paywalls to the app's registry. Unchanged rows aren't rewritten unless their last report is
 * over an hour old, so an SDK reporting on every foreground doesn't write every time.
 */
export async function recordAppPaywalls(db: Db | Tx, appId: string, paywalls: ReportedPaywall[]) {
  if (paywalls.length === 0) return;
  await db
    .insert(appPaywalls)
    .values(
      paywalls.map((p) => ({
        appId,
        paywallId: p.id,
        title: p.title,
        source: p.source,
        presentable: p.presentable,
        products: p.products,
      })),
    )
    .onConflictDoUpdate({
      target: [appPaywalls.appId, appPaywalls.paywallId],
      set: {
        title: sql`excluded.title`,
        source: sql`excluded.source`,
        presentable: sql`excluded.presentable`,
        products: sql`excluded.products`,
        lastReportedAt: sql`now()`,
      },
      setWhere: sql`${appPaywalls.lastReportedAt} < now() - interval '1 hour'
        or (${appPaywalls.title}, ${appPaywalls.source}, ${appPaywalls.presentable}, ${appPaywalls.products})
           is distinct from (excluded.title, excluded.source, excluded.presentable, excluded.products)`,
    });
}

export async function getCardSettings(db: Db, app: { id: string; appStoreId: string | null }): Promise<CardSettings> {
  const [row] = await db.select().from(cardSettings).where(eq(cardSettings.appId, app.id));
  return {
    appStoreId: app.appStoreId,
    reviewTemplates: row?.reviewTemplates ?? DEFAULT_REVIEW_TEMPLATES,
    reviewButtonLabels: row?.reviewButtonLabels ?? [],
    offerButtonLabels: row?.offerButtonLabels ?? [],
  };
}

/**
 * Checks a card against the app and the device, and returns what to store. An offer must name a paywall the
 * device reported it can show; a review needs the app's App Store ID, or the button would lead nowhere.
 */
export function prepareCard(
  input: CardInput,
  app: { name: string; appStoreId: string | null },
  device: { availablePaywalls: ReportedPaywall[] },
): { text: string; card: StoredCard } {
  if (input.kind === "review") {
    if (!app.appStoreId) {
      throw new ApiError(422, "app_store_id_required", "Add the app's App Store ID in its settings to ask for reviews");
    }
    return {
      text: input.text.replaceAll("{app}", app.name),
      card: { type: "review", scenario: input.scenario, buttonLabel: input.buttonLabel },
    };
  }
  const paywall = device.availablePaywalls.find((p) => p.id === input.paywallId);
  if (!paywall || !isPaywallAvailable(device.availablePaywalls, input.paywallId)) {
    throw new ApiError(422, "paywall_unavailable", "This user's app hasn't reported that paywall as available");
  }
  return {
    text: input.text,
    card: { type: "paywall", paywallId: paywall.id, paywallTitle: paywall.title, buttonLabel: input.buttonLabel },
  };
}

/**
 * The repeat guard, run inside the send's transaction (the conversation row is locked): if the last card of
 * this kind got no reply from the user, sending another needs the teammate's explicit confirmation.
 */
export async function guardRepeat(tx: Tx, conversation: ConversationRow, kind: SendCardInput["kind"], confirmed: boolean) {
  if (confirmed) return;
  const [last] = await tx
    .select({ seq: messages.seq })
    .from(messages)
    .where(and(eq(messages.conversationId, conversation.id), eq(messages.kind, kind), sql`${messages.seq} < ${conversation.lastSeq}`))
    .orderBy(desc(messages.seq))
    .limit(1);
  if (!last) return;
  const [reply] = await tx
    .select({ seq: messages.seq })
    .from(messages)
    .where(and(eq(messages.conversationId, conversation.id), eq(messages.sender, "user"), gt(messages.seq, last.seq)))
    .limit(1);
  if (reply) return;
  const what = kind === "review" ? "review request" : "offer";
  throw new ApiError(409, "card_repeat_unconfirmed", `The last ${what} got no reply. Confirm to send another.`);
}

/** After a review card is stored: automations skip devices that were already asked. */
export async function markReviewAsked(tx: Tx, deviceId: string) {
  await tx.update(devices).set({ reviewAskedAt: sql`now()` }).where(eq(devices.id, deviceId));
}

/**
 * Records the first tap on a card in the device's conversations. Later taps return the first one. A receipt
 * the SDK cached offline may carry its tap time, which is kept between the card's sending and now.
 */
export async function recordClick(db: Db, deviceId: string, messageId: string, clickedAt: Date | undefined) {
  const [card] = await db
    .select({ message: messages, conversation: conversations })
    .from(messages)
    .innerJoin(conversations, eq(conversations.id, messages.conversationId))
    .where(and(eq(messages.id, messageId), eq(conversations.deviceId, deviceId)))
    .limit(1);
  if (!card) return null;
  if (card.message.kind === "text") throw new ApiError(422, "not_a_card", "This message has no button");
  if (card.message.actionClickedAt) return { ...card, actionClickedAt: card.message.actionClickedAt, first: false };

  const now = new Date();
  const at = clickedAt && clickedAt < now ? (clickedAt > card.message.createdAt ? clickedAt : card.message.createdAt) : now;
  const [updated] = await db
    .update(messages)
    .set({ actionClickedAt: at })
    .where(and(eq(messages.id, messageId), sql`${messages.actionClickedAt} is null`))
    .returning({ actionClickedAt: messages.actionClickedAt });
  if (updated) return { ...card, actionClickedAt: updated.actionClickedAt!, first: true };
  // a concurrent receipt won
  const [stored] = await db.select({ actionClickedAt: messages.actionClickedAt }).from(messages).where(eq(messages.id, messageId));
  return { ...card, actionClickedAt: stored!.actionClickedAt!, first: false };
}

/** Cards sent from the app's conversations in the last `days`, with first opens, by sender and by paywall. */
export async function cardStats(db: Db, appId: string, days: number): Promise<CardStats> {
  const since = sql`now() - make_interval(days => ${days})`;
  const rows = await db
    .select({
      kind: messages.kind,
      source: messages.source,
      authorId: messages.authorUserId,
      authorName: users.name,
      paywallId: sql<string | null>`${messages.card}->>'paywallId'`,
      paywallTitle: sql<string | null>`max(${messages.card}->>'paywallTitle')`,
      sent: sql<number>`count(*)::int`,
      opened: sql<number>`count(${messages.actionClickedAt})::int`,
    })
    .from(messages)
    .innerJoin(conversations, eq(conversations.id, messages.conversationId))
    .leftJoin(users, eq(users.id, messages.authorUserId))
    .where(
      and(
        inArray(messages.kind, ["review", "paywall"]),
        gte(messages.createdAt, since),
        eq(conversations.appId, appId),
      ),
    )
    .groupBy(messages.kind, messages.source, messages.authorUserId, users.name, sql`${messages.card}->>'paywallId'`);

  const zero = () => ({ sent: 0, opened: 0 });
  const stats: CardStats = { days, review: zero(), offer: zero(), bySender: [], byPaywall: [] };
  const senders = new Map<string, CardStats["bySender"][number]>();
  const paywalls = new Map<string, CardStats["byPaywall"][number]>();
  for (const row of rows) {
    const side = row.kind === "review" ? "review" : "offer";
    stats[side].sent += row.sent;
    stats[side].opened += row.opened;

    const key = `${row.source}:${row.authorId ?? ""}`;
    const sender = senders.get(key) ?? {
      source: row.source as CardStats["bySender"][number]["source"],
      author: row.authorId && row.authorName ? { id: row.authorId, name: row.authorName } : null,
      review: zero(),
      offer: zero(),
    };
    sender[side].sent += row.sent;
    sender[side].opened += row.opened;
    senders.set(key, sender);

    if (row.kind === "paywall" && row.paywallId) {
      const paywall = paywalls.get(row.paywallId) ?? { paywallId: row.paywallId, title: row.paywallTitle ?? row.paywallId, ...zero() };
      paywall.sent += row.sent;
      paywall.opened += row.opened;
      paywalls.set(row.paywallId, paywall);
    }
  }
  stats.bySender = [...senders.values()].sort((a, b) => b.review.sent + b.offer.sent - (a.review.sent + a.offer.sent));
  stats.byPaywall = [...paywalls.values()].sort((a, b) => b.sent - a.sent);
  return stats;
}
