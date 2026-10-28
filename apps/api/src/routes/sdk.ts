import {
  DeviceUpdateInput,
  LogoutInput,
  MessagePageQuery,
  ReadInput,
  RefreshInput,
  RegisterDeviceInput,
  SendMessageInput,
  type DeviceDetails,
  type SdkConversation,
  type SdkMessage,
} from "@hshelby/contracts";
import { decryptSecret, newDeviceSecret, uuidv7 } from "@hshelby/core";
import { apps, conversations, devices } from "@hshelby/db";
import { and, eq, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import type { Deps, SdkEnv } from "../context";
import { hashDeviceSecret, signAccessToken } from "../device-tokens";
import { ApiError } from "../errors";
import { nextIdentity, nextMetadata, sendingState, toSdkIdentity, verifyIdentityToken } from "../identity";
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
const cleanDetails = (details: DeviceDetails = {}) =>
  Object.fromEntries(Object.entries(details).map(([k, v]) => [k, v === "" ? null : v]));

/** The API the iOS SDK talks to, under /v1. */
export function sdkRoutes(deps: Deps) {
  const { db } = deps;
  const r = new Hono<SdkEnv>();
  const auth = requireDevice(deps);

  /** Verifies a token against the app's current secret; rotating the secret invalidates old tokens at once. */
  const claimsFrom = (identitySecretEnc: string, token: string | undefined) =>
    token ? verifyIdentityToken(decryptSecret(identitySecretEnc, deps.keyring), token) : Promise.resolve(null);

  /** Public: the App ID is the only credential an install has before it registers. */
  r.post("/devices", async (c) => {
    const input = await parseJson(c, RegisterDeviceInput);
    const [app] = await db
      .select({ id: apps.id, identitySecretEnc: apps.identitySecretEnc })
      .from(apps)
      .where(and(eq(apps.publicId, input.appId), isNull(apps.deletedAt)))
      .limit(1);
    if (!app) throw new ApiError(404, "not_found", "Unknown App ID");

    const claims = await claimsFrom(app.identitySecretEnc, input.identityToken);
    const identity = nextIdentity({ userIdExt: null, verified: false }, input.identity, claims);

    const deviceId = uuidv7();
    const deviceSecret = newDeviceSecret();
    const [device] = await db
      .insert(devices)
      .values({
        id: deviceId,
        appId: app.id,
        secretHash: hashDeviceSecret(deviceSecret),
        ...cleanDetails(input.device),
        ...identity,
        metadata: input.metadata ? nextMetadata({}, input.metadata) : {},
      })
      .returning();
    const token = await signAccessToken(deps.deviceTokenKey, { deviceId, appId: app.id, sessionVersion: 1 });
    c.header("Cache-Control", "no-store");
    return c.json({ deviceSecret, ...token, identity: toSdkIdentity(device!) }, 201);
  });

  r.post("/session/refresh", async (c) => {
    const { deviceSecret } = await parseJson(c, RefreshInput);
    const [device] = await db
      .select({ id: devices.id, appId: devices.appId, sessionVersion: devices.sessionVersion })
      .from(devices)
      .innerJoin(apps, and(eq(apps.id, devices.appId), isNull(apps.deletedAt)))
      .where(
        and(eq(devices.secretHash, hashDeviceSecret(deviceSecret)), isNull(devices.deletedAt), isNull(devices.signedOutAt)),
      )
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

  /**
   * logout(): ends this device for good (the app registers a new one, which starts a new chat) and keeps
   * the history for the team. Takes the device secret so the SDK can retry it until it succeeds.
   */
  r.post("/session/logout", async (c) => {
    const { deviceSecret } = await parseJson(c, LogoutInput);
    await db
      .update(devices)
      .set({ signedOutAt: new Date(), sessionVersion: sql`${devices.sessionVersion} + 1`, updatedAt: new Date() })
      .where(and(eq(devices.secretHash, hashDeviceSecret(deviceSecret)), isNull(devices.signedOutAt)));
    return c.body(null, 204);
  });

  /** The SDK's staged state: details, identity, metadata. All or nothing. */
  r.patch("/device", auth, async (c) => {
    const input = await parseJson(c, DeviceUpdateInput);
    const claims = await claimsFrom(c.get("app").identitySecretEnc, input.identityToken);
    const device = await db.transaction(async (tx) => {
      // lock the row so concurrent updates can't both pass the identity checks
      const [current] = await tx.select().from(devices).where(eq(devices.id, c.get("device").id)).for("update");
      const [updated] = await tx
        .update(devices)
        .set({
          ...cleanDetails(input.device),
          ...nextIdentity(current!, input.identity, claims),
          ...(input.metadata && { metadata: nextMetadata(current!.metadata, input.metadata) }),
          updatedAt: new Date(),
        })
        .where(eq(devices.id, current!.id))
        .returning();
      return updated!;
    });
    return c.json({ identity: toSdkIdentity(device) });
  });

  /** deleteData(): this device, its identity, metadata, conversations and messages, gone for good. */
  r.delete("/device", auth, async (c) => {
    try {
      await db.delete(devices).where(eq(devices.id, c.get("device").id));
    } catch (err) {
      deps.logger.error({ err, requestId: c.get("requestId") }, "device delete failed");
      throw new ApiError(503, "delete_failed", "Couldn't delete this device's data; try again");
    }
    return c.json({ deleted: true });
  });

  /** First load, polling and catch-up. `conversation` is null until the first message. */
  r.get("/conversation", auth, async (c) => {
    const query = parseQuery(c, MessagePageQuery);
    const device = c.get("device");
    const state = { identity: toSdkIdentity(device), sending: sendingState(device, c.get("app").onlyVerified) };
    const [conversation] = await db
      .select()
      .from(conversations)
      .where(and(eq(conversations.deviceId, device.id), isNull(conversations.supersededAt)))
      .limit(1);
    if (!conversation) return c.json({ ...state, conversation: null, messages: [], hasMore: false });
    const page = await pageMessages(db, conversation.id, query);
    return c.json({
      ...state,
      conversation: toSdkConversation(conversation),
      messages: page.messages.map(toSdkMessage),
      hasMore: page.hasMore,
    });
  });

  /** 201 for a new message, 200 with the stored one when the clientId was already sent. */
  r.post("/messages", auth, async (c) => {
    const input = await parseJson(c, SendMessageInput);
    const device = c.get("device");
    const app = c.get("app");
    const sending = sendingState(device, app.onlyVerified);
    if (sending.reason === "device_blocked") throw new ApiError(403, "device_blocked", "This device can't send messages");
    if (sending.reason === "verification_required") {
      throw new ApiError(403, "verification_required", "Sign in to send messages");
    }
    const result = await appendUserMessage(db, {
      organizationId: app.organizationId,
      appId: app.id,
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
