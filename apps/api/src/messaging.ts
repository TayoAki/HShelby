import type { MessagePageQuery } from "@hshelby/contracts";
import { uuidv7 } from "@hshelby/core";
import { apps, conversations, messages, users, type Db, type Tx } from "@hshelby/db";
import { and, asc, count, desc, eq, gt, isNull, lt, sql } from "drizzle-orm";
import { ApiError, isUniqueViolation, notFound } from "./errors";
import { linkAttachments } from "./photos";
import { publishLive } from "./realtime/events";

/*
 * Every message goes through one short transaction:
 *   1. UPDATE conversations SET last_seq = last_seq + 1 … RETURNING: the row lock serializes concurrent
 *      appends to a conversation, and the new last_seq is the message's seq. No gaps, no reordering.
 *   2. INSERT the message. A resent clientId violates a unique index, the whole transaction rolls back
 *      (seq included), and the caller gets the stored message instead of a duplicate.
 * A teammate's reply also enqueues its push inside the transaction, and every message is announced to live
 * sockets with NOTIFY there too, so a rolled-back message never notifies anyone.
 */

export type MessageRow = typeof messages.$inferSelect;
export type ConversationRow = typeof conversations.$inferSelect;
export type Appended = { message: MessageRow; conversation: ConversationRow; created: boolean };

const live = (deviceId: string) => and(eq(conversations.deviceId, deviceId), isNull(conversations.supersededAt));

/**
 * Appends a message from the device's user, creating its conversation on the first one. Reopens a closed
 * conversation. `verifyAttachments` runs after the replay check, so a resend doesn't re-check sent photos.
 */
export async function appendUserMessage(
  db: Db,
  input: { organizationId: string; appId: string; deviceId: string; clientId: string; text: string; attachmentIds: string[] },
  verifyAttachments: () => Promise<void> = async () => {},
): Promise<Appended> {
  const replay = await findUserReplay(db, input.deviceId, input.clientId);
  if (replay) return replay;
  await verifyAttachments();

  try {
    return await db.transaction(async (tx) => {
      const bump = () =>
        tx
          .update(conversations)
          .set({
            lastSeq: sql`${conversations.lastSeq} + 1`,
            status: "open",
            lastMessageAt: sql`now()`,
            updatedAt: sql`now()`,
            unreadForTeam: sql`${conversations.unreadForTeam} + 1`,
            // the sender has seen everything up to their own message
            userReadSeq: sql`${conversations.lastSeq} + 1`,
            unreadForUser: 0,
          })
          .where(live(input.deviceId))
          .returning();

      let [conversation] = await bump();
      if (!conversation) {
        // A concurrent first send may be creating it too: wait for that insert, then lock the winner's row.
        await tx
          .insert(conversations)
          .values({ id: uuidv7(), organizationId: input.organizationId, appId: input.appId, deviceId: input.deviceId })
          .onConflictDoNothing({ target: conversations.deviceId, where: sql`superseded_at is null` });
        [conversation] = await bump();
      }
      if (!conversation) throw new Error("conversation missing after insert");

      const [message] = await tx
        .insert(messages)
        .values({
          id: uuidv7(),
          conversationId: conversation.id,
          seq: conversation.lastSeq,
          sender: "user",
          source: "sdk",
          deviceId: input.deviceId,
          clientId: input.clientId,
          text: input.text,
        })
        .returning();
      await linkAttachments(tx, { messageId: message!.id, deviceId: input.deviceId, uploadedBy: "user", ids: input.attachmentIds });
      await publishLive(tx, {
        type: "message",
        organizationId: input.organizationId,
        conversationId: conversation.id,
        deviceId: input.deviceId,
        seq: message!.seq,
        sender: "user",
      });

      // Completes the dashboard's "waiting for your first message" step, and marks the setup conversation.
      await tx
        .update(apps)
        .set({ firstMessageAt: sql`now()`, setupConversationId: conversation.id })
        .where(and(eq(apps.id, input.appId), isNull(apps.firstMessageAt)));

      return { message: message!, conversation, created: true };
    });
  } catch (err) {
    if (isUniqueViolation(err, "messages_device_client_uq")) {
      const stored = await findUserReplay(db, input.deviceId, input.clientId);
      if (stored) return stored;
    }
    throw err;
  }
}

/** Appends a teammate's reply to a conversation of their organization and enqueues its push. */
export async function appendAgentMessage(
  db: Db,
  jobs: { pushMessage(tx: Tx, messageId: string): Promise<void> },
  input: {
    organizationId: string;
    conversationId: string;
    authorUserId: string;
    clientId: string;
    text: string;
    attachmentIds: string[];
  },
): Promise<Appended> {
  const replay = await findAgentReplay(db, input);
  if (replay) return replay;

  try {
    return await db.transaction(async (tx) => {
      const [conversation] = await tx
        .update(conversations)
        .set({
          lastSeq: sql`${conversations.lastSeq} + 1`,
          lastMessageAt: sql`now()`,
          updatedAt: sql`now()`,
          unreadForUser: sql`${conversations.unreadForUser} + 1`,
          // replying means the team has read the conversation
          teamReadSeq: sql`${conversations.lastSeq} + 1`,
          unreadForTeam: 0,
        })
        .where(
          and(
            eq(conversations.id, input.conversationId),
            eq(conversations.organizationId, input.organizationId),
            isNull(conversations.supersededAt),
          ),
        )
        .returning();
      if (!conversation) throw notFound("Conversation");

      const [message] = await tx
        .insert(messages)
        .values({
          id: uuidv7(),
          conversationId: conversation.id,
          seq: conversation.lastSeq,
          sender: "agent",
          source: "dashboard",
          authorUserId: input.authorUserId,
          clientId: input.clientId,
          text: input.text,
        })
        .returning();
      await linkAttachments(tx, {
        messageId: message!.id,
        deviceId: conversation.deviceId,
        uploadedBy: "agent",
        ids: input.attachmentIds,
      });
      await jobs.pushMessage(tx, message!.id);
      await publishLive(tx, {
        type: "message",
        organizationId: conversation.organizationId,
        conversationId: conversation.id,
        deviceId: conversation.deviceId,
        seq: message!.seq,
        sender: "agent",
      });
      return { message: message!, conversation, created: true };
    });
  } catch (err) {
    if (isUniqueViolation(err, "messages_author_client_uq")) {
      const stored = await findAgentReplay(db, input);
      if (stored) return stored;
    }
    throw err;
  }
}

async function findUserReplay(db: Db, deviceId: string, clientId: string): Promise<Appended | null> {
  const [row] = await db
    .select({ message: messages, conversation: conversations })
    .from(messages)
    .innerJoin(conversations, eq(conversations.id, messages.conversationId))
    .where(and(eq(messages.deviceId, deviceId), eq(messages.clientId, clientId)))
    .limit(1);
  return row ? { ...row, created: false } : null;
}

async function findAgentReplay(
  db: Db,
  input: { organizationId: string; conversationId: string; authorUserId: string; clientId: string },
): Promise<Appended | null> {
  const [row] = await db
    .select({ message: messages, conversation: conversations })
    .from(messages)
    .innerJoin(conversations, eq(conversations.id, messages.conversationId))
    .where(and(eq(messages.authorUserId, input.authorUserId), eq(messages.clientId, input.clientId)))
    .limit(1);
  if (!row) return null;
  if (row.conversation.id !== input.conversationId || row.conversation.organizationId !== input.organizationId) {
    throw new ApiError(409, "client_id_reused", "This clientId already belongs to another message");
  }
  return { ...row, created: false };
}

const readEvent = (c: ConversationRow, side: "user" | "team", seq: number) =>
  ({ type: "read", organizationId: c.organizationId, conversationId: c.id, deviceId: c.deviceId, side, seq }) as const;

/**
 * Moves the device user's read cursor forward (never back) and recounts their unread agent messages.
 * The row is locked first, so the count runs on a fresh snapshot that includes every committed append.
 */
export async function markUserRead(db: Db, deviceId: string, seq: number): Promise<ConversationRow | null> {
  return db.transaction(async (tx) => {
    const [conversation] = await tx.select().from(conversations).where(live(deviceId)).for("update");
    if (!conversation) return null;
    const readSeq = Math.max(conversation.userReadSeq, Math.min(seq, conversation.lastSeq));
    if (readSeq === conversation.userReadSeq) return conversation;
    const [unread] = await tx
      .select({ n: count() })
      .from(messages)
      .where(and(eq(messages.conversationId, conversation.id), eq(messages.sender, "agent"), gt(messages.seq, readSeq)));
    const [updated] = await tx
      .update(conversations)
      .set({ userReadSeq: readSeq, unreadForUser: unread!.n })
      .where(eq(conversations.id, conversation.id))
      .returning();
    await publishLive(tx, readEvent(updated!, "user", readSeq));
    return updated!;
  });
}

/** The team-side counterpart of `markUserRead`, scoped to the organization. */
export async function markTeamRead(
  db: Db,
  organizationId: string,
  conversationId: string,
  seq: number,
): Promise<ConversationRow | null> {
  return db.transaction(async (tx) => {
    const [conversation] = await tx
      .select()
      .from(conversations)
      .where(and(eq(conversations.id, conversationId), eq(conversations.organizationId, organizationId)))
      .for("update");
    if (!conversation) return null;
    const readSeq = Math.max(conversation.teamReadSeq, Math.min(seq, conversation.lastSeq));
    if (readSeq === conversation.teamReadSeq) return conversation;
    const [unread] = await tx
      .select({ n: count() })
      .from(messages)
      .where(and(eq(messages.conversationId, conversation.id), eq(messages.sender, "user"), gt(messages.seq, readSeq)));
    const [updated] = await tx
      .update(conversations)
      .set({ teamReadSeq: readSeq, unreadForTeam: unread!.n })
      .where(eq(conversations.id, conversation.id))
      .returning();
    await publishLive(tx, readEvent(updated!, "team", readSeq));
    return updated!;
  });
}

export type PagedMessage = MessageRow & { authorName: string | null };

/**
 * One page of a conversation, oldest first. With `after`: messages newer than that seq (polling, catch-up),
 * and `hasMore` means newer ones remain. Otherwise the newest page, or the page before `before`,
 * and `hasMore` means older ones remain.
 */
export async function pageMessages(db: Db, conversationId: string, query: MessagePageQuery) {
  const limit = query.limit ?? 50;
  const base = db
    .select({ message: messages, authorName: users.name })
    .from(messages)
    .leftJoin(users, eq(users.id, messages.authorUserId));

  const newer = query.after !== undefined;
  const rows = newer
    ? await base
        .where(and(eq(messages.conversationId, conversationId), gt(messages.seq, query.after!)))
        .orderBy(asc(messages.seq))
        .limit(limit + 1)
    : await base
        .where(
          and(
            eq(messages.conversationId, conversationId),
            query.before !== undefined ? lt(messages.seq, query.before) : undefined,
          ),
        )
        .orderBy(desc(messages.seq))
        .limit(limit + 1);

  const page = rows.slice(0, limit).map((r): PagedMessage => ({ ...r.message, authorName: r.authorName }));
  return { messages: newer ? page : page.reverse(), hasMore: rows.length > limit };
}
