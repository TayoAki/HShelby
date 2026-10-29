import {
  InboxListQuery,
  isInChat,
  MessagePageQuery,
  messagePreview,
  ReadInput,
  SendCardInput,
  SendMessageInput,
  type Attachment,
  type InboxConversation,
  type InboxDevice,
  type InboxMessage,
} from "@hshelby/contracts";
import { uuidv7 } from "@hshelby/core";
import { apps, attachments, auditEvents, conversations, devices, messages } from "@hshelby/db";
import { and, desc, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import type { AppEnv, Deps } from "../context";
import { ApiError, notFound } from "../errors";
import { guardRepeat, markReviewAsked, prepareCard, toInboxCard } from "../cards";
import { appendAgentMessage, findAgentReplay, markTeamRead, pageMessages, type ConversationRow, type PagedMessage } from "../messaging";
import { requireOrgAdmin } from "../middleware";
import { publishLive } from "../realtime/events";
import {
  attachmentsByMessage,
  checkImage,
  devicePrefix,
  objectKey,
  requireStorage,
  sha256Base64,
  toAttachment,
} from "../photos";
import { isUuid, parseJson, parseQuery } from "../validation";

type DeviceRow = typeof devices.$inferSelect;

const toInboxDevice = (d: DeviceRow): InboxDevice => ({
  id: d.id,
  model: d.model,
  osVersion: d.osVersion,
  appVersion: d.appVersion,
  sdkVersion: d.sdkVersion,
  locale: d.locale,
  timezone: d.timezone,
  blocked: d.blocked,
  lastSeenAt: d.lastSeenAt?.toISOString() ?? null,
  createdAt: d.createdAt.toISOString(),
  userId: d.userIdExt,
  name: d.name,
  email: d.email,
  verified: d.verified,
  verifiedAt: d.verifiedAt?.toISOString() ?? null,
  metadata: d.metadata,
  signedOutAt: d.signedOutAt?.toISOString() ?? null,
  push: {
    enabled: Boolean(d.pushToken) && !d.signedOutAt,
    environment: d.pushEnv,
    issue: d.pushIssue,
    issueAt: d.pushIssueAt?.toISOString() ?? null,
  },
  inChat: isInChat(d),
  lastSeenInChatAt: d.lastSeenInChatAt?.toISOString() ?? null,
  paywalls: d.availablePaywalls,
  paywallsReportedAt: d.paywallsReportedAt?.toISOString() ?? null,
  reviewAskedAt: d.reviewAskedAt?.toISOString() ?? null,
});

/** ILIKE pattern for a literal substring. */
const contains = (q: string) => `%${q.replace(/[\\%_]/g, "\\$&")}%`;

const toInboxMessage = (m: PagedMessage, attachmentsOf: Map<string, Attachment[]>, appStoreId: string | null): InboxMessage => ({
  id: m.id,
  seq: m.seq,
  sender: m.sender,
  source: m.source,
  kind: m.kind,
  text: m.text,
  card: toInboxCard(m.card, appStoreId),
  actionClickedAt: m.actionClickedAt?.toISOString() ?? null,
  clientId: m.sender === "agent" ? m.clientId : null,
  attachments: attachmentsOf.get(m.id) ?? [],
  createdAt: m.createdAt.toISOString(),
  author: m.authorUserId && m.authorName ? { id: m.authorUserId, name: m.authorName } : null,
});

/** Keyset cursor over (last_message_at, id): stable while new messages reorder the inbox. */
const encodeCursor = (c: ConversationRow) => Buffer.from(`${c.lastMessageAt.toISOString()}|${c.id}`).toString("base64url");

function decodeCursor(cursor: string) {
  const [at, id] = Buffer.from(cursor, "base64url").toString().split("|");
  if (!at || !id || !isUuid(id) || Number.isNaN(Date.parse(at))) {
    throw new ApiError(400, "validation_failed", "cursor: invalid");
  }
  return { at, id };
}

/** The team inbox under /api/conversations. Every query is scoped to the active organization. */
export function conversationRoutes(deps: Deps) {
  const { db } = deps;
  const r = new Hono<AppEnv>();

  const summaries = () =>
    db
      .select({
        conversation: conversations,
        app: { id: apps.id, name: apps.name, iconUrl: apps.iconUrl },
        device: devices,
        lastSender: messages.sender,
        lastText: messages.text,
        lastKind: messages.kind,
        lastCard: messages.card,
        setupConversationId: apps.setupConversationId,
        appStoreId: apps.appStoreId,
      })
      .from(conversations)
      .innerJoin(apps, and(eq(apps.id, conversations.appId), isNull(apps.deletedAt)))
      .innerJoin(devices, eq(devices.id, conversations.deviceId))
      .leftJoin(messages, and(eq(messages.conversationId, conversations.id), eq(messages.seq, conversations.lastSeq)));

  type Summary = Awaited<ReturnType<ReturnType<typeof summaries>["execute"]>>[number];

  const toInboxConversation = (row: Summary): InboxConversation => ({
    id: row.conversation.id,
    status: row.conversation.status,
    app: row.app,
    device: toInboxDevice(row.device),
    lastSeq: row.conversation.lastSeq,
    unreadForTeam: row.conversation.unreadForTeam,
    lastMessageAt: row.conversation.lastMessageAt.toISOString(),
    // photo-only messages and cards may have no text to preview
    lastMessage:
      row.lastSender && row.lastText !== null && row.lastKind
        ? { sender: row.lastSender, text: messagePreview({ text: row.lastText, kind: row.lastKind, card: row.lastCard }) }
        : null,
    setup: row.setupConversationId === row.conversation.id,
  });

  async function findConversation(orgId: string, id: string) {
    if (!isUuid(id)) throw notFound("Conversation");
    const [row] = await summaries()
      .where(and(eq(conversations.id, id), eq(conversations.organizationId, orgId)))
      .limit(1);
    if (!row) throw notFound("Conversation");
    return row;
  }

  r.get("/", async (c) => {
    const query = parseQuery(c, InboxListQuery);
    const cursor = query.cursor ? decodeCursor(query.cursor) : null;
    const rows = await summaries()
      .where(
        and(
          eq(conversations.organizationId, c.get("org").id),
          query.status === "all" ? undefined : eq(conversations.status, query.status),
          query.appId ? eq(conversations.appId, query.appId) : undefined,
          query.q
            ? or(
                ilike(devices.name, contains(query.q)),
                ilike(devices.email, contains(query.q)),
                ilike(devices.userIdExt, contains(query.q)),
                ilike(messages.text, contains(query.q)),
              )
            : undefined,
          cursor
            ? sql`(${conversations.lastMessageAt}, ${conversations.id}) < (${cursor.at}::timestamptz, ${cursor.id}::uuid)`
            : undefined,
        ),
      )
      .orderBy(desc(conversations.lastMessageAt), desc(conversations.id))
      .limit(query.limit + 1);
    const page = rows.slice(0, query.limit);
    return c.json({
      conversations: page.map(toInboxConversation),
      nextCursor: rows.length > query.limit ? encodeCursor(page.at(-1)!.conversation) : null,
    });
  });

  r.get("/:id", async (c) => {
    const row = await findConversation(c.get("org").id, c.req.param("id"));
    return c.json({ conversation: toInboxConversation(row) });
  });

  r.get("/:id/messages", async (c) => {
    const query = parseQuery(c, MessagePageQuery);
    const row = await findConversation(c.get("org").id, c.req.param("id"));
    const page = await pageMessages(db, row.conversation.id, query);
    const attachmentsOf = await attachmentsByMessage(db, deps.storage, page.messages.map((m) => m.id));
    return c.json({
      messages: page.messages.map((m) => toInboxMessage(m, attachmentsOf, row.appStoreId)),
      hasMore: page.hasMore,
    });
  });

  /**
   * A teammate's photo for a reply (multipart field `file`). Checked and stored right away; it's sent by
   * replying with its ID, and removed after a day if it never is.
   */
  r.post("/:id/attachments", async (c) => {
    const storage = requireStorage(deps.storage);
    const { conversation } = await findConversation(c.get("org").id, c.req.param("id"));
    await deps.billing.requireCanReply(conversation.organizationId, conversation.id);
    const form = await c.req.parseBody();
    const file = form.file;
    if (!(file instanceof File)) throw new ApiError(400, "validation_failed", "file: attach a photo");
    const body = Buffer.from(await file.arrayBuffer());
    const info = checkImage(body);

    const attachmentId = uuidv7();
    const key = objectKey(conversation.appId, conversation.deviceId, attachmentId, info.contentType);
    await storage.put(key, body, info.contentType);
    const [row] = await db
      .insert(attachments)
      .values({
        id: attachmentId,
        appId: conversation.appId,
        deviceId: conversation.deviceId,
        uploadedBy: "agent",
        authorUserId: c.get("user").id,
        objectKey: key,
        contentType: info.contentType,
        bytes: body.length,
        width: info.width,
        height: info.height,
        sha256: sha256Base64(body),
        status: "verified",
        verifiedAt: new Date(),
      })
      .returning();
    return c.json({ attachment: await toAttachment(storage, row!) }, 201);
  });

  /** A teammate's reply. 201 for a new message, 200 with the stored one when the clientId was already sent. */
  r.post("/:id/messages", async (c) => {
    const input = await parseJson(c, SendMessageInput);
    const id = c.req.param("id");
    if (!isUuid(id)) throw notFound("Conversation");
    const user = c.get("user");
    await deps.billing.requireCanReply(c.get("org").id, id);
    const result = await appendAgentMessage(db, deps.jobs, {
      organizationId: c.get("org").id,
      conversationId: id,
      authorUserId: user.id,
      clientId: input.clientId,
      text: input.text,
      attachmentIds: input.attachmentIds,
    });
    const attachmentsOf = await attachmentsByMessage(db, deps.storage, [result.message.id]);
    const [app] = await db.select({ appStoreId: apps.appStoreId }).from(apps).where(eq(apps.id, result.conversation.appId));
    return c.json(
      { message: toInboxMessage({ ...result.message, authorName: user.name }, attachmentsOf, app?.appStoreId ?? null) },
      result.created ? 201 : 200,
    );
  });

  /**
   * A review request or an offer. An offer must name a paywall the device reported as available; if the last card
   * of the kind got no reply, the teammate confirms the repeat. 201 for a new card, 200 for a resent clientId.
   */
  r.post("/:id/cards", async (c) => {
    const input = await parseJson(c, SendCardInput);
    const org = c.get("org");
    const user = c.get("user");
    const row = await findConversation(org.id, c.req.param("id"));
    // a resent card returns the stored one, even if the paywall has gone since
    const replay = await findAgentReplay(db, { organizationId: org.id, conversationId: row.conversation.id, authorUserId: user.id, clientId: input.clientId });
    if (replay) return c.json({ message: toInboxMessage({ ...replay.message, authorName: user.name }, new Map(), row.appStoreId) });
    await deps.billing.requireCanReply(org.id, row.conversation.id);
    const [app] = await db.select({ name: apps.name }).from(apps).where(eq(apps.id, row.conversation.appId));
    const { text, card } = prepareCard(input, { name: app!.name, appStoreId: row.appStoreId }, row.device);
    const result = await appendAgentMessage(
      db,
      deps.jobs,
      { organizationId: org.id, conversationId: row.conversation.id, authorUserId: user.id, clientId: input.clientId, text, attachmentIds: [], card },
      {
        before: (tx, conversation) => guardRepeat(tx, conversation, input.kind, input.confirmRepeat),
        after: async (tx, _message, conversation) => {
          if (card.type === "review") await markReviewAsked(tx, conversation.deviceId);
        },
      },
    );
    return c.json(
      { message: toInboxMessage({ ...result.message, authorName: user.name }, new Map(), row.appStoreId) },
      result.created ? 201 : 200,
    );
  });

  r.post("/:id/read", async (c) => {
    const { seq } = await parseJson(c, ReadInput);
    const id = c.req.param("id");
    const conversation = isUuid(id) ? await markTeamRead(db, c.get("org").id, id, seq) : null;
    if (!conversation) throw notFound("Conversation");
    return c.json({ unreadForTeam: conversation.unreadForTeam });
  });

  for (const [action, status] of [
    ["resolve", "closed"],
    ["reopen", "open"],
  ] as const) {
    r.post(`/:id/${action}`, async (c) => {
      const id = c.req.param("id");
      const [row] = isUuid(id)
        ? await db
            .update(conversations)
            .set({ status, updatedAt: new Date() })
            .where(and(eq(conversations.id, id), eq(conversations.organizationId, c.get("org").id)))
            .returning({ status: conversations.status, deviceId: conversations.deviceId })
        : [];
      if (!row) throw notFound("Conversation");
      await publishLive(db, { type: "conversation", organizationId: c.get("org").id, conversationId: id, deviceId: row.deviceId });
      return c.json({ status: row.status });
    });
  }

  return r;
}

/** Device actions under /api/devices. */
export function deviceRoutes(deps: Deps) {
  const { db } = deps;
  const r = new Hono<AppEnv>();

  /** Devices are reached through the organization's live apps. */
  const orgApps = (orgId: string) =>
    db
      .select({ id: apps.id })
      .from(apps)
      .where(and(eq(apps.organizationId, orgId), isNull(apps.deletedAt)));

  for (const [action, blocked] of [
    ["block", true],
    ["unblock", false],
  ] as const) {
    r.post(`/:id/${action}`, async (c) => {
      const org = c.get("org");
      const id = c.req.param("id");
      if (!isUuid(id)) throw notFound("Device");
      const device = await db.transaction(async (tx) => {
        const [row] = await tx
          .update(devices)
          .set({ blocked, updatedAt: new Date() })
          .where(and(eq(devices.id, id), inArray(devices.appId, orgApps(org.id))))
          .returning();
        if (row) {
          await tx.insert(auditEvents).values({
            id: uuidv7(),
            organizationId: org.id,
            userId: c.get("user").id,
            action: `device.${action}ed`,
            target: id,
          });
          const [conversation] = await tx
            .select({ id: conversations.id })
            .from(conversations)
            .where(and(eq(conversations.deviceId, id), isNull(conversations.supersededAt)));
          if (conversation) await publishLive(tx, { type: "conversation", organizationId: org.id, conversationId: conversation.id, deviceId: id });
        }
        return row;
      });
      if (!device) throw notFound("Device");
      return c.json({ device: toInboxDevice(device) });
    });
  }

  /** Deletes a user's device with its identity, metadata, conversations and messages. Admins only; audited. */
  r.delete("/:id", requireOrgAdmin, async (c) => {
    const org = c.get("org");
    const id = c.req.param("id");
    if (!isUuid(id)) throw notFound("Device");
    const [device] = await db
      .select({ id: devices.id, appId: devices.appId })
      .from(devices)
      .where(and(eq(devices.id, id), inArray(devices.appId, orgApps(org.id))));
    if (!device) throw notFound("Device");
    try {
      await deps.storage?.deletePrefix(devicePrefix(device.appId, device.id));
    } catch (err) {
      deps.logger.error({ err, requestId: c.get("requestId") }, "photo delete failed");
      throw new ApiError(503, "delete_failed", "Couldn't delete this user's photos; try again");
    }
    const deleted = await db.transaction(async (tx) => {
      const [row] = await tx
        .delete(devices)
        .where(eq(devices.id, device.id))
        .returning({ id: devices.id, appId: devices.appId });
      if (row) {
        await tx.insert(auditEvents).values({
          id: uuidv7(),
          organizationId: org.id,
          userId: c.get("user").id,
          action: "device.deleted",
          target: row.id,
          metadata: { appId: row.appId },
        });
      }
      return row;
    });
    if (!deleted) throw notFound("Device");
    return c.body(null, 204);
  });

  return r;
}
