/* eslint-disable @typescript-eslint/no-explicit-any -- response bodies are asserted on, not typed */
import { randomUUID } from "node:crypto";
import { decryptSecret } from "@hshelby/core";
import { auditEvents, devices, pushConfigs } from "@hshelby/db";
import { createApnsClient } from "@hshelby/push";
import { generateP8, startFakeApns } from "@hshelby/push/testing";
import { eq, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { joinAsMember, makeTestApp, registerDevice, reply, workspaceWithApp } from "./helpers";

const key = generateP8();
const ids = { teamId: "TEAM123456", keyId: "KEY1234567" };
const sandbox = await startFakeApns({ verifyWith: key.publicKey, ...ids });
const production = await startFakeApns({ verifyWith: key.publicKey, ...ids });
const { app, deps, close } = await makeTestApp({
  apns: createApnsClient({ hosts: { sandbox: sandbox.url, production: production.url } }),
});
afterAll(async () => {
  await close();
  await Promise.all([sandbox.close(), production.close()]);
});

let tokenSeq = 0;
const newToken = () => (++tokenSeq).toString(16).padStart(64, "a");
const push = (token: string, environment = "sandbox", extra: Record<string, unknown> = {}) => ({
  push: { token, environment, ...extra },
});
const deviceIdOf = (session: any) => JSON.parse(Buffer.from(session.accessToken.split(".")[1], "base64url").toString()).sub as string;
const deviceRow = async (id: string) => (await deps.db.select().from(devices).where(eq(devices.id, id)))[0]!;
const pushJobs = (messageId: string) =>
  deps.db.execute(sql`select data from pgboss.job where name = 'push.send' and singleton_key = ${messageId}`);

const configure = (call: any, appId: string, body: Record<string, unknown> = {}) =>
  call(`/api/apps/${appId}/push`, {
    method: "PUT",
    body: JSON.stringify({ ...ids, bundleId: "com.example.lockdlist", p8: key.p8, ...body }),
  });

describe("device push tokens", () => {
  it("stores the APNs token and environment, and clears it on request or logout", async () => {
    const { publicId } = await workspaceWithApp(app);
    const token = newToken().toUpperCase();
    const device = await registerDevice(app, publicId, push(token, "sandbox", { updatesAppBadge: false }));
    const id = deviceIdOf(device.session);
    expect(await deviceRow(id)).toMatchObject({ pushToken: token.toLowerCase(), pushEnv: "sandbox", updatesAppBadge: false });

    await device.sdk("/v1/device", { method: "PATCH", json: { push: null } });
    expect(await deviceRow(id)).toMatchObject({ pushToken: null, pushEnv: null });

    await device.sdk("/v1/device", { method: "PATCH", json: push(newToken(), "production") });
    expect((await deviceRow(id)).pushEnv).toBe("production");
    await app.request("/v1/session/logout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ deviceSecret: device.session.deviceSecret }),
    });
    expect((await deviceRow(id)).pushToken).toBeNull();
  });

  it("refuses tokens that aren't raw APNs tokens", async () => {
    const { publicId } = await workspaceWithApp(app);
    const device = await registerDevice(app, publicId);
    const fcm = "dGhpcyBpcyBub3Q:APA91bHun4MxP5egoKMwt2KZFBaFUH-1RYqx";
    expect((await device.sdk("/v1/device", { method: "PATCH", json: push(fcm) })).status).toBe(400);
    expect((await device.sdk("/v1/device", { method: "PATCH", json: push(newToken(), "development") })).status).toBe(400);
  });

  it("moves a token to the newest device that reports it, within the app", async () => {
    const { publicId } = await workspaceWithApp(app);
    const token = newToken();
    const first = await registerDevice(app, publicId, push(token));
    const second = await registerDevice(app, publicId, push(token));
    expect((await deviceRow(deviceIdOf(first.session))).pushToken).toBeNull();
    expect((await deviceRow(deviceIdOf(second.session))).pushToken).toBe(token);

    // another app's device with the same token is left alone
    const other = await workspaceWithApp(app, "Other Owner");
    const elsewhere = await registerDevice(app, other.publicId, push(token));
    expect((await deviceRow(deviceIdOf(second.session))).pushToken).toBe(token);
    expect((await deviceRow(deviceIdOf(elsewhere.session))).pushToken).toBe(token);
  });
});

describe("push jobs", () => {
  it("enqueues one push.send job per reply, and none for the user's own messages", async () => {
    const team = await workspaceWithApp(app);
    const device = await registerDevice(app, team.publicId);
    const { message: userMessage, conversation } = (await (await device.send("hi")).json()) as any;
    expect((await pushJobs(userMessage.id)).rows).toHaveLength(0);

    const clientId = randomUUID();
    const { message } = (await (await reply(team.call, conversation.id, "hello!", clientId)).json()) as any;
    await reply(team.call, conversation.id, "hello!", clientId); // a resend is the same message
    const jobs = await pushJobs(message.id);
    expect(jobs.rows).toEqual([{ data: { messageId: message.id } }]);
  });

  it("enqueues inside the caller's transaction, so a rollback leaves no job", async () => {
    const messageId = randomUUID();
    await expect(
      deps.db.transaction(async (tx) => {
        await deps.jobs.pushMessage(tx, messageId);
        throw new Error("rolled back");
      }),
    ).rejects.toThrow("rolled back");
    expect((await pushJobs(messageId)).rows).toHaveLength(0);

    await deps.db.transaction((tx) => deps.jobs.pushMessage(tx, messageId));
    expect((await pushJobs(messageId)).rows).toHaveLength(1);
  });
});

describe("push settings", () => {
  it("validates and stores the key encrypted, never returning it", async () => {
    const team = await workspaceWithApp(app);
    const initial = (await (await team.call(`/api/apps/${team.appId}/push`)).json()) as any;
    expect(initial).toEqual({ config: null, reachableDevices: 0 });

    const noKey = await configure(team.call, team.appId, { p8: undefined });
    expect(noKey.status).toBe(400);
    const badKey = await configure(team.call, team.appId, { p8: "-----BEGIN PRIVATE KEY-----\nnope\n-----END PRIVATE KEY-----" });
    expect(((await badKey.json()) as any).error.code).toBe("invalid_push_key");
    expect((await configure(team.call, team.appId, { teamId: "team" })).status).toBe(400);

    const res = await configure(team.call, team.appId, { senderName: "  " });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.config).toMatchObject({ ...ids, bundleId: "com.example.lockdlist", titleTemplate: "{app}", senderName: null, issue: null });
    expect(JSON.stringify(body)).not.toContain("PRIVATE KEY");

    const [row] = await deps.db.select().from(pushConfigs).where(eq(pushConfigs.appId, team.appId));
    expect(row!.p8Enc).not.toContain("PRIVATE KEY");
    expect(decryptSecret(row!.p8Enc, deps.keyring)).toBe(key.p8.trim());

    // later edits can leave the key out and keep it
    const edited = await configure(team.call, team.appId, { p8: undefined, bodyTemplate: "{message}", showPreview: false });
    expect(((await edited.json()) as any).config).toMatchObject({ bodyTemplate: "{message}", showPreview: false });
    const [kept] = await deps.db.select().from(pushConfigs).where(eq(pushConfigs.appId, team.appId));
    expect(kept!.p8Enc).toBe(row!.p8Enc);

    expect((await team.call(`/api/apps/${team.appId}/push`, { method: "DELETE" })).status).toBe(204);
    expect(((await (await team.call(`/api/apps/${team.appId}/push`)).json()) as any).config).toBeNull();
    const audit = await deps.db.select({ action: auditEvents.action }).from(auditEvents).where(eq(auditEvents.target, team.appId));
    expect(audit.map((a) => a.action).sort()).toEqual(["app.push.key_uploaded", "app.push.removed", "app.push.updated"]);
  });

  it("is for admins of the app's own workspace", async () => {
    const team = await workspaceWithApp(app);
    const member = await joinAsMember(app, deps, team.call);
    const other = await workspaceWithApp(app, "Other Owner");
    expect((await configure(member.call, team.appId)).status).toBe(403);
    expect((await member.call(`/api/apps/${team.appId}/push/test`, { method: "POST" })).status).toBe(403);
    expect((await member.call(`/api/apps/${team.appId}/push`)).status).toBe(200);
    expect((await configure(other.call, team.appId)).status).toBe(404);
    expect((await other.call(`/api/apps/${team.appId}/push`)).status).toBe(404);
  });
});

describe("send test", () => {
  it("reaches each device in its own environment and records rejections", async () => {
    const team = await workspaceWithApp(app);
    expect(((await (await team.call(`/api/apps/${team.appId}/push/test`, { method: "POST" })).json()) as any).error.code).toBe(
      "push_not_configured",
    );
    await configure(team.call, team.appId);

    const [sandboxToken, productionToken, badToken] = [newToken(), newToken(), newToken()];
    await registerDevice(app, team.publicId, { identity: { name: "Sam" }, ...push(sandboxToken, "sandbox") });
    await registerDevice(app, team.publicId, push(productionToken, "production"));
    const bad = await registerDevice(app, team.publicId, push(badToken, "production"));
    await registerDevice(app, team.publicId); // no token: not reachable
    sandbox.answer(badToken, 400, "BadDeviceToken");
    production.answer(badToken, 400, "BadDeviceToken");

    expect(((await (await team.call(`/api/apps/${team.appId}/push`)).json()) as any).reachableDevices).toBe(3);
    const res = await team.call(`/api/apps/${team.appId}/push/test`, { method: "POST" });
    const { results } = (await res.json()) as any;
    expect(results).toHaveLength(3);
    expect(results.find((r: any) => r.label === "Sam")).toMatchObject({ environment: "sandbox", ok: true });
    expect(results.find((r: any) => r.deviceId === deviceIdOf(bad.session))).toMatchObject({ ok: false, reason: "BadDeviceToken" });

    expect(sandbox.requests.some((r) => r.deviceToken === sandboxToken)).toBe(true);
    expect(production.requests.some((r) => r.deviceToken === productionToken)).toBe(true);
    const testPayload = production.requests.find((r) => r.deviceToken === productionToken)!.payload;
    expect(testPayload.aps).toMatchObject({ alert: { title: `Ada Lovelace's app` } });

    // the rejection shows on the device in the inbox
    const { conversation } = (await (await bad.send("hello")).json()) as any;
    const detail = (await (await team.call(`/api/conversations/${conversation.id}`)).json()) as any;
    expect(detail.conversation.device.push).toMatchObject({ enabled: true, environment: "production", issue: "BadDeviceToken" });
  });

  it("flags the app's settings when APNs rejects the key", async () => {
    const team = await workspaceWithApp(app);
    await configure(team.call, team.appId, { p8: generateP8().p8 }); // a valid key, but not the one APNs knows
    await registerDevice(app, team.publicId, push(newToken()));
    const { results } = (await (await team.call(`/api/apps/${team.appId}/push/test`, { method: "POST" })).json()) as any;
    expect(results[0]).toMatchObject({ ok: false, reason: "InvalidProviderToken" });
    const settings = (await (await team.call(`/api/apps/${team.appId}/push`)).json()) as any;
    expect(settings.config.issue).toBe("InvalidProviderToken");

    // uploading the right key clears the flag
    await configure(team.call, team.appId);
    expect(((await (await team.call(`/api/apps/${team.appId}/push`)).json()) as any).config.issue).toBeNull();
  });
});
