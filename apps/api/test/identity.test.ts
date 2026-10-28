/* eslint-disable @typescript-eslint/no-explicit-any -- response bodies are asserted on, not typed */
import { randomUUID } from "node:crypto";
import { auditEvents, conversations, devices, messages } from "@hshelby/db";
import { eq } from "drizzle-orm";
import { SignJWT } from "jose";
import { afterAll, describe, expect, it } from "vitest";
import { joinAsMember as joinIn, makeTestApp, registerDevice, workspaceWithApp as workspaceIn } from "./helpers";

const { app, deps, close } = await makeTestApp();
afterAll(close);

const workspaceWithApp = (name?: string) => workspaceIn(app, name);
const joinAsMember = (ownerCall: Parameters<typeof joinIn>[2]) => joinIn(app, deps, ownerCall);
const now = () => Math.floor(Date.now() / 1000);

/** A workspace with an app, plus its identity secret as the developer would reveal it. */
async function withSecret(name?: string) {
  const team = await workspaceWithApp(name);
  const res = await team.call(`/api/apps/${team.appId}/identity-secret/reveal`, { method: "POST" });
  const { secret } = (await res.json()) as any;
  return { ...team, secret: secret as string };
}

/** What the developer's server does: HS256 with the `ids_…` secret, verbatim, as the key. */
function mint(secret: string, claims: Record<string, unknown>, alg = "HS256") {
  return new SignJWT(claims).setProtectedHeader({ alg, typ: "JWT" }).sign(new TextEncoder().encode(secret));
}

const register = (publicId: string, body: Record<string, unknown>) =>
  app.request("/v1/devices", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ appId: publicId, ...body }),
  });

const deviceRow = async (id: string) => (await deps.db.select().from(devices).where(eq(devices.id, id)))[0];
const deviceIdOf = (session: any) => JSON.parse(Buffer.from(session.accessToken.split(".")[1], "base64url").toString()).sub as string;

describe("identity token vectors", () => {
  it("accepts a valid token and stores its claims, not the token", async () => {
    const { publicId, secret } = await withSecret();
    const token = await mint(secret, { user_id: "user_123", name: "Alex", email: "alex@example.com", exp: now() + 7 * 86400 });
    const res = await register(publicId, { identityToken: token });
    expect(res.status).toBe(201);
    const session = (await res.json()) as any;
    expect(session.identity).toEqual({ userId: "user_123", name: "Alex", email: "alex@example.com", verified: true });

    const row = await deviceRow(deviceIdOf(session));
    expect(row!.verifiedClaims).toMatchObject({ user_id: "user_123", name: "Alex", email: "alex@example.com" });
    expect(JSON.stringify(row)).not.toContain(token);
  });

  it("accepts an integer user_id and ignores over-long optional claims", async () => {
    const { publicId, secret } = await withSecret();
    const res = await register(publicId, {
      identityToken: await mint(secret, { user_id: 42, name: "x".repeat(201), email: 7, role: "admin", exp: now() + 60 }),
    });
    expect(((await res.json()) as any).identity).toEqual({ userId: "42", name: null, email: null, verified: true });
  });

  const rejected: [string, (secret: string) => Promise<string> | string, string][] = [
    ["sub instead of user_id", (s) => mint(s, { sub: "user_1", exp: now() + 60 }), "identity_token_invalid"],
    ["no exp", (s) => mint(s, { user_id: "user_1" }), "identity_token_invalid"],
    ["expired", (s) => mint(s, { user_id: "user_1", exp: now() - 120 }), "identity_token_expired"],
    ["nbf in the future", (s) => mint(s, { user_id: "user_1", exp: now() + 600, nbf: now() + 300 }), "identity_token_invalid"],
    ["the wrong secret", () => mint("ids_not-this-apps-secret", { user_id: "user_1", exp: now() + 60 }), "identity_token_invalid"],
    ["the secret without its ids_ prefix", (s) => mint(s.slice(4), { user_id: "user_1", exp: now() + 60 }), "identity_token_invalid"],
    ["HS512", (s) => mint(s, { user_id: "user_1", exp: now() + 60 }, "HS512"), "identity_token_invalid"],
    [
      "alg none",
      () =>
        `${Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url")}.${Buffer.from(
          JSON.stringify({ user_id: "user_1", exp: now() + 60 }),
        ).toString("base64url")}.`,
      "identity_token_invalid",
    ],
    ["a 256-character user_id", (s) => mint(s, { user_id: "u".repeat(256), exp: now() + 60 }), "identity_token_invalid"],
    ["a fractional user_id", (s) => mint(s, { user_id: 1.5, exp: now() + 60 }), "identity_token_invalid"],
    ["the identity secret itself", (s) => s, "identity_token_invalid"],
    ["garbage", () => "not.a.jwt", "identity_token_invalid"],
  ];

  it.each(rejected)("rejects a token with %s", async (_, make, code) => {
    const { publicId, secret } = await withSecret();
    const res = await register(publicId, { identityToken: await make(secret) });
    expect(res.status).toBe(422);
    expect(((await res.json()) as any).error.code).toBe(code);
  });

  it("points at user_id when a token uses sub", async () => {
    const { publicId, secret } = await withSecret();
    const res = await register(publicId, { identityToken: await mint(secret, { sub: "user_1", exp: now() + 60 }) });
    expect(((await res.json()) as any).error.message).toMatch(/use "user_id"/);
  });

  it("refuses tokens over 4,096 characters before verifying them", async () => {
    const { publicId, secret } = await withSecret();
    const token = await mint(secret, { user_id: "user_1", exp: now() + 60, pad: "x".repeat(4096) });
    expect((await register(publicId, { identityToken: token })).status).toBe(400);
  });
});

describe("identify labels", () => {
  it("sets unverified labels, keeps omitted fields, and ignores empty strings", async () => {
    const { publicId } = await workspaceWithApp();
    const device = await registerDevice(app, publicId, { identity: { userId: "u1", name: "Sam", email: "sam@example.com" } });
    expect(device.session.identity).toEqual({ userId: "u1", name: "Sam", email: "sam@example.com", verified: false });

    const res = await device.sdk("/v1/device", { method: "PATCH", json: { identity: { name: "Samantha", email: "" } } });
    expect(((await res.json()) as any).identity).toEqual({ userId: "u1", name: "Samantha", email: "sam@example.com", verified: false });
  });

  it("refuses a different user on an identified device, atomically", async () => {
    const { publicId } = await workspaceWithApp();
    const device = await registerDevice(app, publicId, { identity: { userId: "u1" } });
    const res = await device.sdk("/v1/device", {
      method: "PATCH",
      json: { device: { appVersion: "9.9.9" }, identity: { userId: "u2", name: "Someone else" } },
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as any).error.code).toBe("identity_mismatch");
    const row = await deviceRow(deviceIdOf(device.session));
    expect(row).toMatchObject({ userIdExt: "u1", name: null, appVersion: null });
  });

  it("keeps an anonymous user's conversation when they sign in", async () => {
    const { publicId } = await workspaceWithApp();
    const device = await registerDevice(app, publicId);
    const { conversation } = (await (await device.send("question as a guest")).json()) as any;
    await device.sdk("/v1/device", { method: "PATCH", json: { identity: { userId: "u1", name: "Sam" } } });
    const sync = (await (await device.sdk("/v1/conversation")).json()) as any;
    expect(sync.conversation.id).toBe(conversation.id);
    expect(sync.identity).toMatchObject({ userId: "u1", name: "Sam" });
  });
});

describe("verified devices", () => {
  it("never lets labels change a verified identity; a newer token can update it", async () => {
    const { publicId, secret } = await withSecret();
    const device = await registerDevice(app, publicId, {
      identityToken: await mint(secret, { user_id: "u1", name: "Alex", exp: now() + 60 }),
    });
    const patch = (json: unknown) => device.sdk("/v1/device", { method: "PATCH", json });

    const ignored = (await (await patch({ identity: { name: "Not Alex", email: "x@example.com" } })).json()) as any;
    expect(ignored.identity).toEqual({ userId: "u1", name: "Alex", email: null, verified: true });
    expect((await patch({ identity: { userId: "u2" } })).status).toBe(409);

    const newer = await mint(secret, { user_id: "u1", name: "Alex B.", email: "alex@example.com", exp: now() + 60 });
    expect(((await (await patch({ identityToken: newer })).json()) as any).identity).toEqual({
      userId: "u1",
      name: "Alex B.",
      email: "alex@example.com",
      verified: true,
    });
    const otherUser = await mint(secret, { user_id: "u2", exp: now() + 60 });
    expect(((await (await patch({ identityToken: otherUser })).json()) as any).error.code).toBe("identity_mismatch");
  });

  it("keeps verification when a later token is rejected, and applies nothing from that request", async () => {
    const { publicId, secret } = await withSecret();
    const device = await registerDevice(app, publicId, {
      identityToken: await mint(secret, { user_id: "u1", exp: now() + 60 }),
    });
    const expired = await mint(secret, { user_id: "u1", exp: now() - 120 });
    const res = await device.sdk("/v1/device", { method: "PATCH", json: { identityToken: expired, metadata: { plan: "pro" } } });
    expect(((await res.json()) as any).error.code).toBe("identity_token_expired");
    const row = await deviceRow(deviceIdOf(device.session));
    expect(row).toMatchObject({ verified: true, userIdExt: "u1", metadata: {} });
  });
});

describe("metadata", () => {
  it("replaces the whole dictionary, keeps sticky provider IDs, and shows in the inbox", async () => {
    const team = await workspaceWithApp();
    const device = await registerDevice(app, team.publicId, { metadata: { plan: "pro", revenuecat_id: "rc_1" } });
    const patch = (metadata: unknown) => device.sdk("/v1/device", { method: "PATCH", json: { metadata } });

    await patch({ seats: "3" });
    let row = await deviceRow(deviceIdOf(device.session));
    expect(row!.metadata).toEqual({ seats: "3", revenuecat_id: "rc_1" });

    await patch({});
    row = await deviceRow(deviceIdOf(device.session));
    expect(row!.metadata).toEqual({ revenuecat_id: "rc_1" });

    await patch({ revenuecat_id: "rc_2", plan: "team" });
    const { conversation } = (await (await device.send("hi")).json()) as any;
    const detail = (await (await team.call(`/api/conversations/${conversation.id}`)).json()) as any;
    expect(detail.conversation.device.metadata).toEqual({ revenuecat_id: "rc_2", plan: "team" });
  });

  it("enforces the limits", async () => {
    const { publicId } = await workspaceWithApp();
    const device = await registerDevice(app, publicId);
    const patch = (metadata: unknown) => device.sdk("/v1/device", { method: "PATCH", json: { metadata } });
    const many = Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`k${i}`, "v"]));
    expect((await patch(many)).status).toBe(400);
    expect((await patch({ ["k".repeat(65)]: "v" })).status).toBe(400);
    expect((await patch({ k: "v".repeat(513) })).status).toBe(400);
    expect((await patch({ count: 3 })).status).toBe(400);
    expect((await patch({ "": "v" })).status).toBe(400);
    const twenty = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`k${i}`, "v".repeat(512)]));
    expect((await patch(twenty)).status).toBe(200);
  });
});

describe("only verified users can chat", () => {
  it("lets unverified devices read but not send", async () => {
    const team = await withSecret();
    const res = await team.call(`/api/apps/${team.appId}`, { method: "PATCH", body: JSON.stringify({ onlyVerified: true }) });
    expect(((await res.json()) as any).app.onlyVerified).toBe(true);

    const guest = await registerDevice(app, team.publicId, { identity: { userId: "labelled-only" } });
    const sync = (await (await guest.sdk("/v1/conversation")).json()) as any;
    expect(sync.sending).toEqual({ allowed: false, reason: "verification_required" });
    const refused = await guest.send("hello?");
    expect(refused.status).toBe(403);
    expect(((await refused.json()) as any).error.code).toBe("verification_required");

    const verified = await registerDevice(app, team.publicId, {
      identityToken: await mint(team.secret, { user_id: "u1", exp: now() + 60 }),
    });
    expect((await verified.send("hello")).status).toBe(201);

    const audit = await deps.db.select({ action: auditEvents.action }).from(auditEvents).where(eq(auditEvents.target, team.appId));
    expect(audit.map((a) => a.action)).toContain("app.only_verified.enabled");
  });

  it("is an admin setting", async () => {
    const team = await workspaceWithApp();
    const member = await joinAsMember(team.call);
    const res = await member.call(`/api/apps/${team.appId}`, { method: "PATCH", body: JSON.stringify({ onlyVerified: true }) });
    expect(res.status).toBe(403);
    // members can still rename
    expect((await member.call(`/api/apps/${team.appId}`, { method: "PATCH", body: JSON.stringify({ name: "Renamed" }) })).status).toBe(200);
  });
});

describe("secret rotation", () => {
  it("invalidates tokens signed with the old secret at once", async () => {
    const team = await withSecret();
    const res = await team.call(`/api/apps/${team.appId}/identity-secret/rotate`, { method: "POST", body: "{}" });
    expect(res.headers.get("cache-control")).toBe("no-store");
    const { secret } = (await res.json()) as any;
    expect(secret).toMatch(/^ids_/);
    expect(secret).not.toBe(team.secret);

    const old = await register(team.publicId, { identityToken: await mint(team.secret, { user_id: "u1", exp: now() + 60 }) });
    expect(old.status).toBe(422);
    const fresh = await register(team.publicId, { identityToken: await mint(secret, { user_id: "u1", exp: now() + 60 }) });
    expect(fresh.status).toBe(201);
  });

  it("can mark existing users unverified, and is admin-only", async () => {
    const team = await withSecret();
    const device = await registerDevice(app, team.publicId, {
      identityToken: await mint(team.secret, { user_id: "u1", exp: now() + 60 }),
    });
    const member = await joinAsMember(team.call);
    const rotate = (call: typeof team.call, body: unknown) =>
      call(`/api/apps/${team.appId}/identity-secret/rotate`, { method: "POST", body: JSON.stringify(body) });

    expect((await rotate(member.call, {})).status).toBe(403);
    await rotate(team.call, {});
    expect((await deviceRow(deviceIdOf(device.session)))!.verified).toBe(true);
    await rotate(team.call, { unverifyExisting: true });
    expect((await deviceRow(deviceIdOf(device.session)))!.verified).toBe(false);
  });
});

describe("logout", () => {
  it("ends the device for good, keeps the history, and is safe to retry", async () => {
    const team = await workspaceWithApp();
    const device = await registerDevice(app, team.publicId, { identity: { userId: "u1", name: "Sam" } });
    const { conversation } = (await (await device.send("before logout")).json()) as any;
    const logout = (deviceSecret: string) =>
      app.request("/v1/session/logout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ deviceSecret }),
      });

    expect((await logout(device.session.deviceSecret)).status).toBe(204);
    expect((await device.sdk("/v1/unread")).status).toBe(401);
    const refresh = await app.request("/v1/session/refresh", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ deviceSecret: device.session.deviceSecret }),
    });
    expect(refresh.status).toBe(401);
    expect((await logout(device.session.deviceSecret)).status).toBe(204);
    expect((await logout("dvs_unknown")).status).toBe(204);

    const detail = (await (await team.call(`/api/conversations/${conversation.id}`)).json()) as any;
    expect(detail.conversation.device).toMatchObject({ name: "Sam", userId: "u1" });
    expect(detail.conversation.device.signedOutAt).not.toBeNull();

    // the next launch registers again and starts a new chat
    const next = await registerDevice(app, team.publicId);
    expect(((await (await next.sdk("/v1/conversation")).json()) as any).conversation).toBeNull();
  });
});

describe("deleting data", () => {
  async function deviceWithHistory(team: Awaited<ReturnType<typeof workspaceWithApp>>) {
    const device = await registerDevice(app, team.publicId, { identity: { userId: "u1" }, metadata: { plan: "pro" } });
    const { conversation } = (await (await device.send("delete me")).json()) as any;
    await team.call(`/api/conversations/${conversation.id}/messages`, {
      method: "POST",
      body: JSON.stringify({ clientId: randomUUID(), text: "ok" }),
    });
    return { device, deviceId: deviceIdOf(device.session), conversationId: conversation.id as string };
  }

  async function expectGone(deviceId: string, conversationId: string) {
    expect(await deps.db.select().from(devices).where(eq(devices.id, deviceId))).toHaveLength(0);
    expect(await deps.db.select().from(conversations).where(eq(conversations.id, conversationId))).toHaveLength(0);
    expect(await deps.db.select().from(messages).where(eq(messages.conversationId, conversationId))).toHaveLength(0);
  }

  it("deleteData() removes the device, its conversations and every message", async () => {
    const team = await workspaceWithApp();
    const { device, deviceId, conversationId } = await deviceWithHistory(team);
    const res = await device.sdk("/v1/device", { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: true });
    await expectGone(deviceId, conversationId);
    expect((await device.sdk("/v1/unread")).status).toBe(401);
    expect(((await (await team.call("/api/conversations?status=all")).json()) as any).conversations).toHaveLength(0);
  });

  it("admins can delete a user's data from the dashboard; members and other workspaces can't", async () => {
    const team = await workspaceWithApp();
    const { deviceId, conversationId } = await deviceWithHistory(team);
    const member = await joinAsMember(team.call);
    const other = await workspaceWithApp("Other Owner");

    expect((await member.call(`/api/devices/${deviceId}`, { method: "DELETE" })).status).toBe(403);
    expect((await other.call(`/api/devices/${deviceId}`, { method: "DELETE" })).status).toBe(404);
    expect((await team.call(`/api/devices/${deviceId}`, { method: "DELETE" })).status).toBe(204);
    await expectGone(deviceId, conversationId);
    const audit = await deps.db.select({ action: auditEvents.action }).from(auditEvents).where(eq(auditEvents.target, deviceId));
    expect(audit.map((a) => a.action)).toEqual(["device.deleted"]);
  });
});

describe("inbox search", () => {
  it("matches name, email, user ID and the latest message, literally", async () => {
    const team = await workspaceWithApp();
    const people = [
      { identity: { name: "Grace Hopper" }, text: "first" },
      { identity: { email: "ada@example.com" }, text: "second" },
      { identity: { userId: "cust_991" }, text: "third" },
      { identity: {}, text: "refund please, 100% broken" },
    ];
    for (const p of people) await (await registerDevice(app, team.publicId, { identity: p.identity })).send(p.text);

    const search = async (q: string) =>
      ((await (await team.call(`/api/conversations?q=${encodeURIComponent(q)}`)).json()) as any).conversations.map(
        (c: any) => c.lastMessage.text,
      );
    expect(await search("grace")).toEqual(["first"]);
    expect(await search("ADA@")).toEqual(["second"]);
    expect(await search("991")).toEqual(["third"]);
    expect(await search("refund")).toEqual(["refund please, 100% broken"]);
    expect(await search("100%")).toEqual(["refund please, 100% broken"]);
    expect(await search("%")).toEqual(["refund please, 100% broken"]);
    expect(await search("nobody")).toEqual([]);
  });
});
