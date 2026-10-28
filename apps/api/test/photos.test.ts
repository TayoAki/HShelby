/* eslint-disable @typescript-eslint/no-explicit-any -- response bodies are asserted on, not typed */
import { createHash, randomUUID } from "node:crypto";
import { attachments } from "@hshelby/db";
import { jpegBytes, pngBytes, testStorage } from "@hshelby/storage/testing";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { makeTestApp, ORIGIN, registerDevice, reply, workspaceWithApp } from "./helpers";

const { storage } = await testStorage();
const { app, deps, close } = await makeTestApp({ storage });
afterAll(async () => {
  storage.close();
  await close();
});

const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("base64");
const HOUR = 60 * 60 * 1000;
type Device = Awaited<ReturnType<typeof registerDevice>>;

/** The SDK's upload: ask for a ticket describing `declared`, then PUT `actual` (normally the same bytes). */
async function upload(device: Device, declared: Buffer, options: { actual?: Buffer | null; contentType?: string; width?: number; height?: number } = {}) {
  const res = await device.sdk("/v1/uploads", {
    json: {
      contentType: options.contentType ?? "image/png",
      bytes: declared.length,
      width: options.width ?? 946,
      height: options.height ?? 2048,
      checksum: sha256(declared),
    },
  });
  expect(res.status).toBe(201);
  const ticket = (await res.json()) as any;
  const actual = options.actual === undefined ? declared : options.actual;
  if (actual) {
    const put = await fetch(ticket.uploadUrl, { method: ticket.method, headers: ticket.headers, body: actual });
    expect(put.status).toBe(200);
  }
  return ticket.attachmentId as string;
}

const sendPhotos = (device: Device, attachmentIds: string[], text = "", clientId = randomUUID()) =>
  device.sdk("/v1/messages", { json: { clientId, text, attachmentIds } });

/** A teammate's upload through the dashboard (multipart, with the session cookie). */
async function teamUpload(cookie: string, conversationId: string, body: Buffer, name = "photo.jpg") {
  const form = new FormData();
  form.set("file", new File([body], name));
  return app.request(`/api/conversations/${conversationId}/attachments`, { method: "POST", body: form, headers: { cookie, origin: ORIGIN } });
}

describe("user photos", () => {
  it("sends a photo the server has checked, and serves it through a signed link", async () => {
    const team = await workspaceWithApp(app);
    const device = await registerDevice(app, team.publicId);
    const photo = pngBytes(946, 2048, 5000); // a 1170×2532 screenshot after the SDK resizes it
    const id = await upload(device, photo);

    const res = await sendPhotos(device, [id]);
    expect(res.status).toBe(201);
    const { message } = (await res.json()) as any;
    expect(message.text).toBe("");
    expect(message.attachments).toEqual([
      { id, url: expect.any(String), contentType: "image/png", width: 946, height: 2048 },
    ]);
    expect(Buffer.from(await (await fetch(message.attachments[0].url)).arrayBuffer()).equals(photo)).toBe(true);

    const [row] = await deps.db.select().from(attachments).where(eq(attachments.id, id));
    expect(row).toMatchObject({ status: "verified", messageId: message.id });

    // the team sees it, and the inbox previews a photo-only message as "Photo"
    const list = (await (await team.call("/api/conversations")).json()) as any;
    expect(list.conversations[0].lastMessage).toEqual({ sender: "user", text: "Photo" });
    const thread = (await (await team.call(`/api/conversations/${list.conversations[0].id}/messages`)).json()) as any;
    expect(thread.messages[0].attachments).toHaveLength(1);
  });

  it("refuses a photo whose bytes don't match the declared checksum", async () => {
    const { publicId } = await workspaceWithApp(app);
    const device = await registerDevice(app, publicId);
    const declared = pngBytes(100, 100, 400);
    const tampered = Buffer.from(declared);
    tampered[399] = 1; // same size, different content
    const id = await upload(device, declared, { actual: tampered });

    const res = await sendPhotos(device, [id], "look");
    expect(res.status).toBe(422);
    expect(((await res.json()) as any).error.code).toBe("invalid_attachment");
    expect(((await (await device.sdk("/v1/conversation")).json()) as any).conversation).toBeNull();
  });

  it("asks for the upload when it hasn't happened yet, and accepts the retry", async () => {
    const { publicId } = await workspaceWithApp(app);
    const device = await registerDevice(app, publicId);
    const photo = jpegBytes(800, 600, 2000);
    const ticketRes = await device.sdk("/v1/uploads", {
      json: { contentType: "image/jpeg", bytes: photo.length, width: 800, height: 600, checksum: sha256(photo) },
    });
    const ticket = (await ticketRes.json()) as any;
    const clientId = randomUUID();
    const early = await sendPhotos(device, [ticket.attachmentId], "", clientId);
    expect(early.status).toBe(409);
    expect(((await early.json()) as any).error.code).toBe("upload_incomplete");

    await fetch(ticket.uploadUrl, { method: "PUT", headers: ticket.headers, body: photo });
    expect((await sendPhotos(device, [ticket.attachmentId], "", clientId)).status).toBe(201);
    // a resend of the same message is the stored message, photo included
    const again = await sendPhotos(device, [ticket.attachmentId], "", clientId);
    expect(again.status).toBe(200);
    expect(((await again.json()) as any).message.attachments).toHaveLength(1);
  });

  it("judges type and size from the file, not from what was declared", async () => {
    const { publicId } = await workspaceWithApp(app);
    const device = await registerDevice(app, publicId);
    const gif = Buffer.from("GIF89a".padEnd(300, "x"));
    const jpegCalledPng = jpegBytes(500, 500, 300);
    const huge = pngBytes(4000, 1000, 300); // declared as 2048 wide
    for (const id of [
      await upload(device, gif),
      await upload(device, jpegCalledPng, { contentType: "image/png" }),
      await upload(device, huge, { width: 2048, height: 512 }),
    ]) {
      const res = await sendPhotos(device, [id]);
      expect(res.status).toBe(422);
    }
  });

  it("validates upload requests and photo messages", async () => {
    const { publicId } = await workspaceWithApp(app);
    const device = await registerDevice(app, publicId);
    const ok = { contentType: "image/jpeg", bytes: 1000, width: 100, height: 100, checksum: sha256(Buffer.from("x")) };
    for (const bad of [
      { ...ok, contentType: "image/gif" },
      { ...ok, bytes: 1024 * 1024 + 1 },
      { ...ok, width: 4096 },
      { ...ok, checksum: "abc" },
    ]) {
      expect((await device.sdk("/v1/uploads", { json: bad })).status).toBe(400);
    }
    const ids = Array.from({ length: 5 }, () => randomUUID());
    expect((await sendPhotos(device, ids)).status).toBe(400);
    expect((await sendPhotos(device, [ids[0]!, ids[0]!])).status).toBe(400);
    expect((await device.sdk("/v1/messages", { json: { clientId: randomUUID() } })).status).toBe(400);
  });

  it("won't attach another device's upload, or one that was already sent", async () => {
    const { publicId } = await workspaceWithApp(app);
    const a = await registerDevice(app, publicId);
    const b = await registerDevice(app, publicId);
    const id = await upload(a, pngBytes(10, 10, 100));
    expect((await sendPhotos(b, [id])).status).toBe(422);
    expect((await sendPhotos(a, [id])).status).toBe(201);
    expect((await sendPhotos(a, [id])).status).toBe(422);
  });

  it("won't send an upload after 23 hours, an hour before the sweep removes it", async () => {
    const { publicId } = await workspaceWithApp(app);
    const device = await registerDevice(app, publicId);
    const id = await upload(device, pngBytes(10, 10, 100));
    await deps.db.update(attachments).set({ createdAt: new Date(Date.now() - 23 * HOUR - 60_000) }).where(eq(attachments.id, id));
    const res = await sendPhotos(device, [id]);
    expect(res.status).toBe(422);
    expect(((await res.json()) as any).error.code).toBe("invalid_attachment");
  });

  it("limits unsent uploads, and refuses them to blocked devices", async () => {
    const team = await workspaceWithApp(app);
    const device = await registerDevice(app, team.publicId);
    const ids: string[] = [];
    for (let i = 0; i < 20; i++) ids.push(await upload(device, pngBytes(10, 10, 100), { actual: null }));
    const res = await device.sdk("/v1/uploads", {
      json: { contentType: "image/png", bytes: 100, width: 10, height: 10, checksum: sha256(pngBytes(10, 10, 100)) },
    });
    expect(res.status).toBe(429);
    expect(((await res.json()) as any).error.code).toBe("too_many_uploads");
    // expired uploads no longer count
    await deps.db.update(attachments).set({ createdAt: new Date(Date.now() - 23 * HOUR - 60_000) }).where(eq(attachments.id, ids[0]!));
    await upload(device, pngBytes(10, 10, 100), { actual: null });

    const other = await registerDevice(app, team.publicId);
    const { conversation } = (await (await other.send("hi")).json()) as any;
    const { conversation: detail } = (await (await team.call(`/api/conversations/${conversation.id}`)).json()) as any;
    await team.call(`/api/devices/${detail.device.id}/block`, { method: "POST" });
    const refused = await other.sdk("/v1/uploads", {
      json: { contentType: "image/png", bytes: 100, width: 10, height: 10, checksum: sha256(Buffer.from("y")) },
    });
    expect(refused.status).toBe(403);
  });
});

describe("teammate photos", () => {
  it("are checked on upload, sent with a reply, and reach the user's app", async () => {
    const team = await workspaceWithApp(app);
    const device = await registerDevice(app, team.publicId);
    const { conversation } = (await (await device.send("how do I share?")).json()) as any;
    const photo = jpegBytes(1024, 768, 4000);

    const up = await teamUpload(team.cookie, conversation.id, photo);
    expect(up.status).toBe(201);
    const { attachment } = (await up.json()) as any;
    expect(attachment).toMatchObject({ contentType: "image/jpeg", width: 1024, height: 768 });

    const res = await reply(team.call, conversation.id, "", randomUUID());
    expect(res.status).toBe(400); // nothing to send
    const sent = await team.call(`/api/conversations/${conversation.id}/messages`, {
      method: "POST",
      body: JSON.stringify({ clientId: randomUUID(), text: "Tap Share here:", attachmentIds: [attachment.id] }),
    });
    expect(sent.status).toBe(201);

    const sync = (await (await device.sdk("/v1/conversation")).json()) as any;
    const agentMessage = sync.messages.find((m: any) => m.sender === "agent");
    expect(agentMessage.attachments).toHaveLength(1);
    expect(Buffer.from(await (await fetch(agentMessage.attachments[0].url)).arrayBuffer()).equals(photo)).toBe(true);
  });

  it("refuses files that aren't photos, oversized ones, and use in another conversation", async () => {
    const team = await workspaceWithApp(app);
    const a = (await (await (await registerDevice(app, team.publicId)).send("a")).json()) as any;
    const b = (await (await (await registerDevice(app, team.publicId)).send("b")).json()) as any;
    expect((await teamUpload(team.cookie, a.conversation.id, Buffer.from("not an image at all"), "notes.txt")).status).toBe(422);
    expect((await teamUpload(team.cookie, a.conversation.id, jpegBytes(100, 100, 1200 * 1024))).status).toBe(413);

    const { attachment } = (await (await teamUpload(team.cookie, a.conversation.id, pngBytes(50, 50, 200))).json()) as any;
    const misuse = await team.call(`/api/conversations/${b.conversation.id}/messages`, {
      method: "POST",
      body: JSON.stringify({ clientId: randomUUID(), text: "", attachmentIds: [attachment.id] }),
    });
    expect(misuse.status).toBe(422);
  });
});

describe("deleting data", () => {
  it("removes the device's photos, the user's and the team's", async () => {
    const team = await workspaceWithApp(app);
    const device = await registerDevice(app, team.publicId);
    const userPhoto = await upload(device, pngBytes(20, 20, 300));
    const { conversation } = (await (await sendPhotos(device, [userPhoto], "here")).json()) as any;
    const { attachment } = (await (await teamUpload(team.cookie, conversation.id, jpegBytes(30, 30, 300))).json()) as any;
    await team.call(`/api/conversations/${conversation.id}/messages`, {
      method: "POST",
      body: JSON.stringify({ clientId: randomUUID(), text: "", attachmentIds: [attachment.id] }),
    });
    const [userRow] = await deps.db.select().from(attachments).where(eq(attachments.id, userPhoto));
    const objectKeys = (
      await deps.db.select({ key: attachments.objectKey }).from(attachments).where(eq(attachments.deviceId, userRow!.deviceId))
    ).map((r) => r.key);
    expect(objectKeys).toHaveLength(2);
    for (const key of objectKeys) expect(await storage.read(key, 10)).not.toBeNull();

    expect((await device.sdk("/v1/device", { method: "DELETE" })).status).toBe(200);
    for (const key of objectKeys) expect(await storage.read(key, 10)).toBeNull();
    expect(await deps.db.select().from(attachments).where(eq(attachments.id, userPhoto))).toHaveLength(0);
  });

  it("removes them when an admin deletes the user's data too", async () => {
    const team = await workspaceWithApp(app);
    const device = await registerDevice(app, team.publicId);
    const id = await upload(device, pngBytes(20, 20, 300));
    const { conversation } = (await (await sendPhotos(device, [id])).json()) as any;
    const [row] = await deps.db.select().from(attachments).where(eq(attachments.id, id));
    const { conversation: detail } = (await (await team.call(`/api/conversations/${conversation.id}`)).json()) as any;
    expect((await team.call(`/api/devices/${detail.device.id}`, { method: "DELETE" })).status).toBe(204);
    expect(await storage.read(row!.objectKey, 10)).toBeNull();
  });
});

describe("without a bucket", () => {
  it("turns photos off but keeps text messaging", async () => {
    const noBucket = await makeTestApp({ storage: null });
    try {
      const { publicId } = await workspaceWithApp(noBucket.app);
      const device = await registerDevice(noBucket.app, publicId);
      const res = await device.sdk("/v1/uploads", {
        json: { contentType: "image/png", bytes: 100, width: 10, height: 10, checksum: sha256(Buffer.from("z")) },
      });
      expect(res.status).toBe(503);
      expect(((await res.json()) as any).error.code).toBe("uploads_not_configured");
      expect((await device.send("text still works")).status).toBe(201);
    } finally {
      await noBucket.close();
    }
  });
});
