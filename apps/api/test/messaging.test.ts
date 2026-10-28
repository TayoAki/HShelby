/* eslint-disable @typescript-eslint/no-explicit-any -- response bodies are asserted on, not typed */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { auditEvents, devices, messages } from "@hshelby/db";
import { eq } from "drizzle-orm";
import { SignJWT } from "jose";
import { afterAll, describe, expect, it } from "vitest";
import { makeTestApp, registerDevice, reply, workspaceWithApp as workspaceIn } from "./helpers";

const { app, deps, pool } = makeTestApp();
afterAll(() => pool.end());

const workspaceWithApp = (name?: string) => workspaceIn(app, name);

describe("device registration and tokens", () => {
  it("registers with a public App ID and stores only a hash of the device secret", async () => {
    const { publicId, appId } = await workspaceWithApp();
    const { session } = await registerDevice(app, publicId, { device: { model: "iPhone16,1", osVersion: "18.1", locale: "" } });
    expect(session.deviceSecret).toMatch(/^dvs_[0-9A-Za-z]{43}$/);
    expect(session.expiresIn).toBe(900);

    const [row] = await deps.db.select().from(devices).where(eq(devices.appId, appId));
    expect(row!.secretHash).toBe(createHash("sha256").update(session.deviceSecret).digest("hex"));
    expect(row).toMatchObject({ model: "iPhone16,1", osVersion: "18.1", locale: null, sessionVersion: 1 });
  });

  it("rejects unknown App IDs", async () => {
    const res = await app.request("/v1/devices", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ appId: `app_${"x".repeat(22)}` }),
    });
    expect(res.status).toBe(404);
  });

  it("refuses missing, forged and outdated tokens, and refreshes with the device secret", async () => {
    const { publicId } = await workspaceWithApp();
    const device = await registerDevice(app, publicId);

    expect((await app.request("/v1/unread")).status).toBe(401);
    device.setToken("not-a-token");
    expect((await device.sdk("/v1/unread")).status).toBe(401);

    // same claims, wrong key
    const claims = JSON.parse(Buffer.from(device.session.accessToken.split(".")[1], "base64url").toString());
    const forged = await new SignJWT({ app: claims.app, sv: claims.sv })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(claims.sub)
      .setAudience("sdk")
      .setExpirationTime("15m")
      .sign(randomBytes(32));
    device.setToken(forged);
    expect((await device.sdk("/v1/unread")).status).toBe(401);

    const refresh = (deviceSecret: string) =>
      app.request("/v1/session/refresh", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ deviceSecret }),
      });
    expect((await refresh("dvs_wrong")).status).toBe(401);
    const refreshed = (await (await refresh(device.session.deviceSecret)).json()) as any;
    device.setToken(refreshed.accessToken);
    expect((await device.sdk("/v1/unread")).status).toBe(200);

    // bumping the session version (logout/delete in B4) kills outstanding tokens
    await deps.db.update(devices).set({ sessionVersion: 2 }).where(eq(devices.id, claims.sub));
    expect((await device.sdk("/v1/unread")).status).toBe(401);
    device.setToken(((await (await refresh(device.session.deviceSecret)).json()) as any).accessToken);
    expect((await device.sdk("/v1/unread")).status).toBe(200);
  });

  it("ends device sessions when the app is deleted", async () => {
    const { publicId, appId, call } = await workspaceWithApp();
    const device = await registerDevice(app, publicId);
    expect((await call(`/api/apps/${appId}`, { method: "DELETE" })).status).toBe(204);
    expect((await device.sdk("/v1/unread")).status).toBe(401);
  });
});

describe("sending", () => {
  it("creates the conversation on the first message and completes onboarding's first-message step", async () => {
    const { publicId, appId, call } = await workspaceWithApp();
    const device = await registerDevice(app, publicId);

    const empty = (await (await device.sdk("/v1/conversation")).json()) as any;
    expect(empty).toEqual({
      identity: { userId: null, name: null, email: null, verified: false },
      sending: { allowed: true, reason: null },
      conversation: null,
      messages: [],
      hasMore: false,
    });

    const res = await device.send("  Hello, is anyone there?  ");
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.message).toMatchObject({ seq: 1, sender: "user", text: "Hello, is anyone there?" });
    expect(body.conversation).toMatchObject({ status: "open", lastSeq: 1, userReadSeq: 1, unread: 0 });

    const status = (await (await call(`/api/apps/${appId}/status`)).json()) as any;
    expect(status.firstMessageAt).not.toBeNull();
  });

  it("returns the stored message when a clientId is resent", async () => {
    const { publicId } = await workspaceWithApp();
    const device = await registerDevice(app, publicId);
    const clientId = randomUUID();
    const first = (await (await device.send("once", clientId)).json()) as any;
    const again = await device.send("once", clientId);
    expect(again.status).toBe(200);
    expect(((await again.json()) as any).message.id).toBe(first.message.id);
    const rows = await deps.db.select().from(messages).where(eq(messages.conversationId, first.conversation.id));
    expect(rows).toHaveLength(1);
  });

  it("orders 200 concurrent sends with 20% retries into exactly 200 messages, seq 1–200", async () => {
    const { publicId } = await workspaceWithApp();
    const device = await registerDevice(app, publicId);
    const clientIds = Array.from({ length: 200 }, () => randomUUID());
    // every fifth message is also retried, concurrently with its first attempt
    const attempts = [...clientIds, ...clientIds.filter((_, i) => i % 5 === 0)];
    expect(attempts).toHaveLength(240);

    const responses = await Promise.all(attempts.map((id, i) => device.send(`message ${i}`, id)));
    expect(responses.every((r) => r.status === 201 || r.status === 200)).toBe(true);
    const bodies = (await Promise.all(responses.map((r) => r.json()))) as any[];

    // both attempts for a clientId got the same message back
    const byClient = new Map<string, string>();
    for (const b of bodies) {
      const seen = byClient.get(b.message.clientId);
      if (seen) expect(b.message.id).toBe(seen);
      byClient.set(b.message.clientId, b.message.id);
    }
    expect(byClient.size).toBe(200);

    const conversationId = bodies[0].conversation.id;
    const rows = await deps.db.select({ seq: messages.seq }).from(messages).where(eq(messages.conversationId, conversationId));
    expect(rows).toHaveLength(200);
    expect(rows.map((r) => r.seq).sort((a, b) => a - b)).toEqual(Array.from({ length: 200 }, (_, i) => i + 1));

    const sync = (await (await device.sdk("/v1/conversation?after=0&limit=100")).json()) as any;
    expect(sync.conversation.lastSeq).toBe(200);
    expect(sync.messages).toHaveLength(100);
    expect(sync.hasMore).toBe(true);
  });

  it("validates message bodies", async () => {
    const { publicId } = await workspaceWithApp();
    const device = await registerDevice(app, publicId);
    expect((await device.send("   ")).status).toBe(400);
    expect((await device.send("x".repeat(4001))).status).toBe(400);
    expect((await device.sdk("/v1/messages", { json: { clientId: "not-a-uuid", text: "hi" } })).status).toBe(400);
    expect((await device.sdk("/v1/messages", { json: { clientId: randomUUID(), text: "hi", extra: 1 } })).status).toBe(400);
  });
});

describe("inbox and replies", () => {
  it("lists the conversation, takes a reply, and the SDK sees it on its next poll", async () => {
    const team = await workspaceWithApp();
    const device = await registerDevice(app, team.publicId, { device: { model: "iPhone15,2", appVersion: "2.3.0" } });
    await device.send("My list won't sync");
    await device.send("Since this morning");

    const list = (await (await team.call("/api/conversations")).json()) as any;
    expect(list.conversations).toHaveLength(1);
    const [summary] = list.conversations;
    expect(summary).toMatchObject({
      status: "open",
      lastSeq: 2,
      unreadForTeam: 2,
      lastMessage: { sender: "user", text: "Since this morning" },
      app: { id: team.appId },
      device: { model: "iPhone15,2", appVersion: "2.3.0", blocked: false },
    });

    const res = await reply(team.call, summary.id, "Looking into it now");
    expect(res.status).toBe(201);
    const { message } = (await res.json()) as any;
    expect(message).toMatchObject({ seq: 3, sender: "agent", source: "dashboard", author: { name: "Ada Lovelace" } });

    // replying marks the conversation read for the team
    const after = (await (await team.call(`/api/conversations/${summary.id}`)).json()) as any;
    expect(after.conversation.unreadForTeam).toBe(0);

    const poll = (await (await device.sdk("/v1/conversation?after=2")).json()) as any;
    expect(poll.messages).toEqual([
      expect.objectContaining({ seq: 3, sender: "agent", text: "Looking into it now", clientId: null }),
    ]);
    expect(poll.conversation.unread).toBe(1);
    expect(((await (await device.sdk("/v1/unread")).json()) as any).unread).toBe(1);
  });

  it("keeps unread counts right on both sides", async () => {
    const team = await workspaceWithApp();
    const device = await registerDevice(app, team.publicId);
    const { conversation } = (await (await device.send("hi")).json()) as any;
    for (const text of ["one", "two", "three"]) await reply(team.call, conversation.id, text);

    expect(((await (await device.sdk("/v1/unread")).json()) as any).unread).toBe(3);
    // read up to the second reply (seq 3)
    expect(((await (await device.sdk("/v1/read", { json: { seq: 3 } })).json()) as any).unread).toBe(1);
    // the cursor never moves back, and can't pass the last message
    expect(((await (await device.sdk("/v1/read", { json: { seq: 1 } })).json()) as any).unread).toBe(1);
    expect(((await (await device.sdk("/v1/read", { json: { seq: 999 } })).json()) as any).unread).toBe(0);

    await device.send("thanks"); // seq 5
    await device.send("one more thing"); // seq 6
    const read = (seq: number) =>
      team.call(`/api/conversations/${conversation.id}/read`, { method: "POST", body: JSON.stringify({ seq }) });
    expect(((await (await read(5)).json()) as any).unreadForTeam).toBe(1);
    expect(((await (await read(6)).json()) as any).unreadForTeam).toBe(0);
  });

  it("resolves, filters by status, and reopens when the user writes again", async () => {
    const team = await workspaceWithApp();
    const device = await registerDevice(app, team.publicId);
    const { conversation } = (await (await device.send("question")).json()) as any;

    const resolved = await team.call(`/api/conversations/${conversation.id}/resolve`, { method: "POST" });
    expect(((await resolved.json()) as any).status).toBe("closed");
    expect(((await (await team.call("/api/conversations")).json()) as any).conversations).toHaveLength(0);
    expect(((await (await team.call("/api/conversations?status=closed")).json()) as any).conversations).toHaveLength(1);

    await device.send("follow-up");
    const open = (await (await team.call("/api/conversations")).json()) as any;
    expect(open.conversations[0]).toMatchObject({ id: conversation.id, status: "open" });
  });

  it("pages the inbox with a stable cursor and the thread in both directions", async () => {
    const team = await workspaceWithApp();
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const device = await registerDevice(app, team.publicId);
      ids.unshift(((await (await device.send(`device ${i}`)).json()) as any).conversation.id);
    }
    const first = (await (await team.call("/api/conversations?limit=2")).json()) as any;
    expect(first.conversations.map((c: any) => c.id)).toEqual(ids.slice(0, 2));
    const second = (await (await team.call(`/api/conversations?limit=2&cursor=${first.nextCursor}`)).json()) as any;
    expect(second.conversations.map((c: any) => c.id)).toEqual(ids.slice(2));
    expect(second.nextCursor).toBeNull();
    expect((await team.call("/api/conversations?cursor=bogus")).status).toBe(400);

    const device = await registerDevice(app, team.publicId);
    let conversationId = "";
    for (let i = 1; i <= 5; i++) conversationId = ((await (await device.send(`m${i}`)).json()) as any).conversation.id;
    const latest = (await (await team.call(`/api/conversations/${conversationId}/messages?limit=2`)).json()) as any;
    expect(latest.messages.map((m: any) => m.seq)).toEqual([4, 5]);
    expect(latest.hasMore).toBe(true);
    const older = (await (await team.call(`/api/conversations/${conversationId}/messages?limit=2&before=4`)).json()) as any;
    expect(older.messages.map((m: any) => m.seq)).toEqual([2, 3]);
    const newer = (await (await device.sdk("/v1/conversation?after=3")).json()) as any;
    expect(newer.messages.map((m: any) => m.seq)).toEqual([4, 5]);
    expect(newer.hasMore).toBe(false);
  });

  it("treats a resent reply as one message, and refuses a clientId from another conversation", async () => {
    const team = await workspaceWithApp();
    const a = (await (await (await registerDevice(app, team.publicId)).send("a")).json()) as any;
    const b = (await (await (await registerDevice(app, team.publicId)).send("b")).json()) as any;
    const clientId = randomUUID();
    const first = (await (await reply(team.call, a.conversation.id, "hi", clientId)).json()) as any;
    const again = await reply(team.call, a.conversation.id, "hi", clientId);
    expect(again.status).toBe(200);
    expect(((await again.json()) as any).message.id).toBe(first.message.id);
    const elsewhere = await reply(team.call, b.conversation.id, "hi", clientId);
    expect(elsewhere.status).toBe(409);
    expect(((await elsewhere.json()) as any).error.code).toBe("client_id_reused");
  });
});

describe("blocking and isolation", () => {
  it("stops a blocked device from sending until it's unblocked, and audits both", async () => {
    const team = await workspaceWithApp();
    const device = await registerDevice(app, team.publicId);
    const { conversation } = (await (await device.send("spam")).json()) as any;
    const { conversation: summary } = (await (await team.call(`/api/conversations/${conversation.id}`)).json()) as any;

    const blocked = await team.call(`/api/devices/${summary.device.id}/block`, { method: "POST" });
    expect(((await blocked.json()) as any).device.blocked).toBe(true);
    const refused = await device.send("more spam");
    expect(refused.status).toBe(403);
    expect(((await refused.json()) as any).error.code).toBe("device_blocked");
    // a blocked user can still read the conversation
    expect((await device.sdk("/v1/conversation")).status).toBe(200);

    await team.call(`/api/devices/${summary.device.id}/unblock`, { method: "POST" });
    expect((await device.send("sorry")).status).toBe(201);

    const audit = await deps.db.select({ action: auditEvents.action }).from(auditEvents).where(eq(auditEvents.target, summary.device.id));
    expect(audit.map((a) => a.action).sort()).toEqual(["device.blocked", "device.unblocked"]);
  });

  it("hides one workspace's conversations and devices from another", async () => {
    const owner = await workspaceWithApp("Owner One");
    const device = await registerDevice(app, owner.publicId);
    const { conversation } = (await (await device.send("private")).json()) as any;
    const { conversation: summary } = (await (await owner.call(`/api/conversations/${conversation.id}`)).json()) as any;

    const other = await workspaceWithApp("Other Two");
    expect(((await (await other.call("/api/conversations?status=all")).json()) as any).conversations).toHaveLength(0);
    for (const [path, method] of [
      [`/api/conversations/${conversation.id}`, "GET"],
      [`/api/conversations/${conversation.id}/messages`, "GET"],
      [`/api/conversations/${conversation.id}/resolve`, "POST"],
      [`/api/devices/${summary.device.id}/block`, "POST"],
    ] as const) {
      expect((await other.call(path, { method })).status, path).toBe(404);
    }
    expect((await reply(other.call, conversation.id, "hijack")).status).toBe(404);
    const read = await other.call(`/api/conversations/${conversation.id}/read`, { method: "POST", body: JSON.stringify({ seq: 1 }) });
    expect(read.status).toBe(404);

    const rows = await deps.db.select().from(messages).where(eq(messages.conversationId, conversation.id));
    expect(rows).toHaveLength(1);
  });
});
