import {
  InboxListQuery,
  MessagePageQuery,
  ReadInput,
  SendMessageInput,
  type InboxConversation,
  type InboxDevice,
  type InboxMessage,
} from "@hshelby/contracts";
import { uuidv7 } from "@hshelby/core";
import { apps, auditEvents, conversations, devices, messages } from "@hshelby/db";
import { and, desc, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import type { AppEnv, Deps } from "../context";
import { ApiError, notFound } from "../errors";
import { appendAgentMessage, markTeamRead, pageMessages, type ConversationRow, type PagedMessage } from "../messaging";
import { requireOrgAdmin } from "../middleware";
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
});

/** ILIKE pattern for a literal substring. */
const contains = (q: string) => `%${q.replace(/[\\%_]/g, "\\$&")}%`;

const toInboxMessage = (m: PagedMessage): InboxMessage => ({
  id: m.id,
  seq: m.seq,
  sender: m.sender,
  source: m.source,
  text: m.text,
  clientId: m.sender === "agent" ? m.clientId : null,
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
    lastMessage: row.lastSender && row.lastText !== null ? { sender: row.lastSender, text: row.lastText } : null,
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
    return c.json({ messages: page.messages.map(toInboxMessage), hasMore: page.hasMore });
  });

  /** A teammate's reply. 201 for a new message, 200 with the stored one when the clientId was already sent. */
  r.post("/:id/messages", async (c) => {
    const input = await parseJson(c, SendMessageInput);
    const id = c.req.param("id");
    if (!isUuid(id)) throw notFound("Conversation");
    const user = c.get("user");
    const result = await appendAgentMessage(db, deps.jobs, {
      organizationId: c.get("org").id,
      conversationId: id,
      authorUserId: user.id,
      clientId: input.clientId,
      text: input.text,
    });
    return c.json({ message: toInboxMessage({ ...result.message, authorName: user.name }) }, result.created ? 201 : 200);
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
            .returning({ status: conversations.status })
        : [];
      if (!row) throw notFound("Conversation");
      return c.json(row);
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
    const deleted = await db.transaction(async (tx) => {
      const [row] = await tx
        .delete(devices)
        .where(and(eq(devices.id, id), inArray(devices.appId, orgApps(org.id))))
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
