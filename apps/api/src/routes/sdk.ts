import {
  DeviceUpdateInput,
  LogoutInput,
  MessagePageQuery,
  ReadInput,
  RefreshInput,
  RegisterDeviceInput,
  SendMessageInput,
  UploadRequest,
  PHOTO_LIMITS,
  type Attachment,
  type DeviceDetails,
  type PushRegistration,
  type SdkConversation,
  type SdkMessage,
  type UploadTicket,
} from "@hshelby/contracts";
import { decryptSecret, newDeviceSecret, uuidv7 } from "@hshelby/core";
import { apps, attachments, conversations, devices, type Db, type Tx } from "@hshelby/db";
import { and, count, eq, gt, isNull, ne, sql } from "drizzle-orm";
import { Hono } from "hono";
import type { Deps, SdkEnv } from "../context";
import { hashDeviceSecret, signAccessToken } from "../device-tokens";
import { ApiError } from "../errors";
import { nextIdentity, nextMetadata, sendingState, toSdkIdentity, verifyIdentityToken } from "../identity";
import { appendUserMessage, markUserRead, pageMessages, type ConversationRow, type MessageRow } from "../messaging";
import { requireDevice } from "../middleware";
import {
  attachmentsByMessage,
  devicePrefix,
  objectKey,
  requireStorage,
  sendableSince,
  UPLOAD_URL_SECONDS,
  verifyUploads,
} from "../photos";
import { parseJson, parseQuery } from "../validation";

const toSdkConversation = (c: ConversationRow): SdkConversation => ({
  id: c.id,
  status: c.status,
  lastSeq: c.lastSeq,
  userReadSeq: c.userReadSeq,
  unread: c.unreadForUser,
});

const toSdkMessage = (m: MessageRow, attachmentsOf: Map<string, Attachment[]>): SdkMessage => ({
  id: m.id,
  seq: m.seq,
  sender: m.sender,
  text: m.text,
  // only the device's own client IDs; a teammate's are none of its business
  clientId: m.sender === "user" ? m.clientId : null,
  attachments: attachmentsOf.get(m.id) ?? [],
  createdAt: m.createdAt.toISOString(),
});

/** Sending and uploading are refused the same way: blocked devices, and unverified ones where only verified users may chat. */
function assertCanSend(device: Parameters<typeof sendingState>[0], onlyVerified: boolean) {
  const sending = sendingState(device, onlyVerified);
  if (sending.reason === "device_blocked") throw new ApiError(403, "device_blocked", "This device can't send messages");
  if (sending.reason === "verification_required") throw new ApiError(403, "verification_required", "Sign in to send messages");
}

/** Empty strings from the SDK mean "unknown". */
const cleanDetails = (details: DeviceDetails = {}) =>
  Object.fromEntries(Object.entries(details).map(([k, v]) => [k, v === "" ? null : v]));

/** Push columns for a registration or update: undefined leaves them alone, null clears the token. */
const pushColumns = (push: PushRegistration | null | undefined) => {
  if (push === undefined) return {};
  if (push === null) return { pushToken: null, pushEnv: null };
  return {
    pushToken: push.token,
    pushEnv: push.environment,
    updatesAppBadge: push.updatesAppBadge,
    pushIssue: null,
    pushIssueAt: null,
  };
};

/**
 * One phone, one recipient: a token that moves to a new device record (after a logout or reinstall)
 * is taken off the app's other devices, so nobody gets the same notification twice.
 */
async function releasePushToken(db: Db | Tx, appId: string, token: string, keepDeviceId: string) {
  await db
    .update(devices)
    .set({ pushToken: null, pushEnv: null })
    .where(and(eq(devices.appId, appId), eq(devices.pushToken, token), ne(devices.id, keepDeviceId)));
}

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
    const device = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(devices)
        .values({
          id: deviceId,
          appId: app.id,
          secretHash: hashDeviceSecret(deviceSecret),
          ...cleanDetails(input.device),
          ...identity,
          metadata: input.metadata ? nextMetadata({}, input.metadata) : {},
          ...pushColumns(input.push),
        })
        .returning();
      if (input.push) await releasePushToken(tx, app.id, input.push.token, deviceId);
      return row;
    });
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
      .set({
        signedOutAt: new Date(),
        sessionVersion: sql`${devices.sessionVersion} + 1`,
        pushToken: null,
        pushEnv: null,
        updatedAt: new Date(),
      })
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
          ...pushColumns(input.push),
          updatedAt: new Date(),
        })
        .where(eq(devices.id, current!.id))
        .returning();
      if (input.push) await releasePushToken(tx, current!.appId, input.push.token, current!.id);
      return updated!;
    });
    return c.json({ identity: toSdkIdentity(device) });
  });

  /** deleteData(): this device, its identity, metadata, conversations and messages, gone for good. */
  r.delete("/device", auth, async (c) => {
    const device = c.get("device");
    try {
      // photos first: if that fails, the device is still there and the SDK retries
      await deps.storage?.deletePrefix(devicePrefix(device.appId, device.id));
      await db.delete(devices).where(eq(devices.id, device.id));
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
    const attachmentsOf = await attachmentsByMessage(db, deps.storage, page.messages.map((m) => m.id));
    return c.json({
      ...state,
      conversation: toSdkConversation(conversation),
      messages: page.messages.map((m) => toSdkMessage(m, attachmentsOf)),
      hasMore: page.hasMore,
    });
  });

  /**
   * An upload ticket for one photo: a presigned PUT for the declared type, size and SHA-256. The photo is
   * checked against those when a message is sent with it; unsent uploads are removed after a day.
   */
  r.post("/uploads", auth, async (c) => {
    const storage = requireStorage(deps.storage);
    const input = await parseJson(c, UploadRequest);
    const device = c.get("device");
    const app = c.get("app");
    assertCanSend(device, app.onlyVerified);
    const [unsent] = await db
      .select({ n: count() })
      .from(attachments)
      .where(
        and(
          eq(attachments.deviceId, device.id),
          eq(attachments.uploadedBy, "user"),
          isNull(attachments.messageId),
          gt(attachments.createdAt, sendableSince()),
        ),
      );
    if (unsent!.n >= PHOTO_LIMITS.unsentPerDevice) {
      throw new ApiError(429, "too_many_uploads", "Send or discard earlier photos first");
    }

    const attachmentId = uuidv7();
    const key = objectKey(app.id, device.id, attachmentId, input.contentType);
    await db.insert(attachments).values({
      id: attachmentId,
      appId: app.id,
      deviceId: device.id,
      uploadedBy: "user",
      objectKey: key,
      contentType: input.contentType,
      bytes: input.bytes,
      width: input.width,
      height: input.height,
      sha256: input.checksum,
    });
    const { url, headers } = await storage.presignUpload({
      key,
      contentType: input.contentType,
      bytes: input.bytes,
      sha256: input.checksum,
      expiresIn: UPLOAD_URL_SECONDS,
    });
    const ticket: UploadTicket = { attachmentId, uploadUrl: url, method: "PUT", headers, expiresIn: UPLOAD_URL_SECONDS };
    return c.json(ticket, 201);
  });

  /** 201 for a new message, 200 with the stored one when the clientId was already sent. */
  r.post("/messages", auth, async (c) => {
    const input = await parseJson(c, SendMessageInput);
    const device = c.get("device");
    const app = c.get("app");
    assertCanSend(device, app.onlyVerified);
    const result = await appendUserMessage(
      db,
      {
        organizationId: app.organizationId,
        appId: app.id,
        deviceId: device.id,
        clientId: input.clientId,
        text: input.text,
        attachmentIds: input.attachmentIds,
      },
      async () => {
        // text-only messages work without a bucket
        if (input.attachmentIds.length > 0) await verifyUploads(db, requireStorage(deps.storage), device.id, input.attachmentIds);
      },
    );
    const attachmentsOf = await attachmentsByMessage(db, deps.storage, [result.message.id]);
    return c.json(
      { message: toSdkMessage(result.message, attachmentsOf), conversation: toSdkConversation(result.conversation) },
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
