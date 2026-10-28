import {
  DeviceDetails,
  MessagePageQuery,
  ReadInput,
  RefreshInput,
  RegisterDeviceInput,
  SendMessageInput,
  type SdkConversation,
  type SdkMessage,
} from "@hshelby/contracts";
import { newDeviceSecret, uuidv7 } from "@hshelby/core";
import { apps, conversations, devices } from "@hshelby/db";
import { and, eq, isNull } from "drizzle-orm";
import { Hono } from "hono";
import type { Deps, SdkEnv } from "../context";
import { hashDeviceSecret, signAccessToken } from "../device-tokens";
import { ApiError } from "../errors";
import { appendUserMessage, markUserRead, pageMessages, type ConversationRow, type MessageRow } from "../messaging";
import { requireDevice } from "../middleware";
import { parseJson, parseQuery } from "../validation";

const toSdkConversation = (c: ConversationRow): SdkConversation => ({
  id: c.id,
  status: c.status,
  lastSeq: c.lastSeq,
  userReadSeq: c.userReadSeq,
  unread: c.unreadForUser,
});

const toSdkMessage = (m: MessageRow): SdkMessage => ({
  id: m.id,
  seq: m.seq,
  sender: m.sender,
  text: m.text,
  // only the device's own client IDs; a teammate's are none of its business
  clientId: m.sender === "user" ? m.clientId : null,
  createdAt: m.createdAt.toISOString(),
});

/** Empty strings from the SDK mean "unknown". */
const cleanDetails = (details: DeviceDetails) =>
  Object.fromEntries(Object.entries(details).map(([k, v]) => [k, v === "" ? null : v]));

/** The API the iOS SDK talks to, under /v1. */
export function sdkRoutes(deps: Deps) {
  const { db } = deps;
  const r = new Hono<SdkEnv>();
  const auth = requireDevice(deps);

  /** Public: the App ID is the only credential an install has before it registers. */
  r.post("/devices", async (c) => {
    const input = await parseJson(c, RegisterDeviceInput);
    const [app] = await db
      .select({ id: apps.id })
      .from(apps)
      .where(and(eq(apps.publicId, input.appId), isNull(apps.deletedAt)))
      .limit(1);
    if (!app) throw new ApiError(404, "not_found", "Unknown App ID");

    const deviceId = uuidv7();
    const deviceSecret = newDeviceSecret();
    await db.insert(devices).values({
      id: deviceId,
      appId: app.id,
      secretHash: hashDeviceSecret(deviceSecret),
      ...cleanDetails(input.device),
    });
    const token = await signAccessToken(deps.deviceTokenKey, { deviceId, appId: app.id, sessionVersion: 1 });
    c.header("Cache-Control", "no-store");
    return c.json({ deviceSecret, ...token }, 201);
  });

  r.post("/session/refresh", async (c) => {
    const { deviceSecret } = await parseJson(c, RefreshInput);
    const [device] = await db
      .select({ id: devices.id, appId: devices.appId, sessionVersion: devices.sessionVersion })
      .from(devices)
      .innerJoin(apps, and(eq(apps.id, devices.appId), isNull(apps.deletedAt)))
      .where(and(eq(devices.secretHash, hashDeviceSecret(deviceSecret)), isNull(devices.deletedAt)))
      .limit(1);
    if (!device) throw new ApiError(401, "unauthorized", "Unknown device; register again");
    c.header("Cache-Control", "no-store");
    return c.json(
      await signAccessToken(deps.deviceTokenKey, {
        deviceId: device.id,
        appId: device.appId,
        sessionVersion: device.sessionVersion,
      }),
    );
  });

  r.patch("/device", auth, async (c) => {
    const details = await parseJson(c, DeviceDetails);
    if (Object.keys(details).length > 0) {
      await db
        .update(devices)
        .set({ ...cleanDetails(details), updatedAt: new Date() })
        .where(eq(devices.id, c.get("device").id));
    }
    return c.body(null, 204);
  });

  /** First load, polling and catch-up. `conversation` is null until the first message. */
  r.get("/conversation", auth, async (c) => {
    const query = parseQuery(c, MessagePageQuery);
    const [conversation] = await db
      .select()
      .from(conversations)
      .where(and(eq(conversations.deviceId, c.get("device").id), isNull(conversations.supersededAt)))
      .limit(1);
    if (!conversation) return c.json({ conversation: null, messages: [], hasMore: false });
    const page = await pageMessages(db, conversation.id, query);
    return c.json({
      conversation: toSdkConversation(conversation),
      messages: page.messages.map(toSdkMessage),
      hasMore: page.hasMore,
    });
  });

  /** 201 for a new message, 200 with the stored one when the clientId was already sent. */
  r.post("/messages", auth, async (c) => {
    const input = await parseJson(c, SendMessageInput);
    const device = c.get("device");
    if (device.blocked) throw new ApiError(403, "device_blocked", "This device can't send messages");
    const result = await appendUserMessage(db, {
      organizationId: c.get("organizationId"),
      appId: device.appId,
      deviceId: device.id,
      clientId: input.clientId,
      text: input.text,
    });
    return c.json(
      { message: toSdkMessage(result.message), conversation: toSdkConversation(result.conversation) },
      result.created ? 201 : 200,
    );
  });

  r.post("/read", auth, async (c) => {
    const { seq } = await parseJson(c, ReadInput);
    const conversation = await markUserRead(db, c.get("device").id, seq);
    return c.json({ unread: conversation?.unreadForUser ?? 0 });
  });

  /** What the SDK polls for its badge while the chat is closed. */
  r.get("/unread", auth, async (c) => {
    const [row] = await db
      .select({ unread: conversations.unreadForUser })
      .from(conversations)
      .where(and(eq(conversations.deviceId, c.get("device").id), isNull(conversations.supersededAt)))
      .limit(1);
    return c.json({ unread: row?.unread ?? 0 });
  });

  return r;
}
