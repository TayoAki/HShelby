/* eslint-disable @typescript-eslint/no-explicit-any -- response bodies are asserted on, not typed */
import { randomBytes } from "node:crypto";
import { auditEvents, betaAccess, betaInvites, invitations, members, partnerApps } from "@hshelby/db";
import { generateP8 } from "@hshelby/push/testing";
import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import type { Email } from "../src/email";
import { parsePartners } from "../src/partners";
import { makeTestApp, ORIGIN, registerDevice } from "./helpers";

const KEY = randomBytes(32).toString("hex");
const OTHER_KEY = randomBytes(32).toString("hex");
const sent: Email[] = [];
const { app, deps, close } = await makeTestApp(
  { mailer: { enabled: true, send: async (email) => void sent.push(email) } },
  // the closed beta, as in production: owners get in through the partner's invitation
  { SIGNUPS: "invite", PARTNERS: `app-builder:${KEY}, other:${OTHER_KEY}`, PARTNER_BETA_DAYS: "30" },
);
afterAll(close);

const partner = (path: string, init: { method?: string; json?: unknown } = {}, key = KEY) =>
  app.request(`/partner/v1${path}`, {
    method: init.method ?? "GET",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    ...(init.json !== undefined && { body: JSON.stringify(init.json) }),
  });
const put = (id: string, json: unknown, key = KEY) => partner(`/apps/${id}`, { method: "PUT", json }, key);
const address = (name: string) => `${name}-${randomBytes(4).toString("hex")}@example.com`;
const project = () => `proj_${randomBytes(6).toString("hex")}`;
const signUpAs = (email: string, name = "Olive Owner") =>
  app.request("/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN },
    body: JSON.stringify({ name, email, password: "correct horse battery" }),
  });
const cookieOf = (res: Response) => res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
const asUser = (cookie: string, path: string) => app.request(path, { headers: { cookie, origin: ORIGIN } });

describe("partner keys", () => {
  it("are required, and a typo in PARTNERS fails at startup", async () => {
    expect((await app.request("/partner/v1/apps/x")).status).toBe(401);
    expect((await partner("/apps/x", {}, "wrong".repeat(10))).status).toBe(401);
    expect(() => parsePartners("app-builder")).toThrow(/id:key/);
    expect(() => parsePartners("app-builder:short")).toThrow(/at least 32/);
    expect(() => parsePartners(`Bad Id:${KEY}`)).toThrow(/slug/);
    expect(parsePartners(`app-builder:${KEY}`)(KEY)).toEqual({ id: "app-builder", name: "App Builder" });
  });
});

describe("creating an app for a new owner", () => {
  it("returns the App ID at once, gives the workspace beta access and invites the owner", async () => {
    const email = address("olive");
    const id = project();
    const res = await put(id, { name: "Habit Tracker", owner: { email: email.toUpperCase(), name: "Olive Owner" }, bundleId: "com.example.habit" });
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body).toMatchObject({
      externalId: id,
      app: { name: "Habit Tracker", bundleId: "com.example.habit" },
      workspace: { name: "Olive's App Builder apps" },
      owner: { email, status: "invited" },
      urls: { inbox: `${ORIGIN}/inbox`, signUp: `${ORIGIN}/sign-up?email=${encodeURIComponent(email)}&next=%2Finbox` },
      apiBaseUrl: "https://api.test",
      push: { configured: false },
    });
    expect(body.app.appId).toMatch(/^app_[0-9A-Za-z]{22}$/);

    // the SDK works with it straight away
    const device = await registerDevice(app, body.app.appId);
    expect((await device.send("Hello?")).status).toBe(201);

    const [access] = await deps.db.select().from(betaAccess).where(eq(betaAccess.organizationId, body.workspace.id));
    expect(access!.note).toBe("partner:app-builder");
    expect(Math.round((access!.until.getTime() - Date.now()) / 86_400_000)).toBe(30);
    const [invitation] = await deps.db.select().from(invitations).where(eq(invitations.organizationId, body.workspace.id));
    expect(invitation).toMatchObject({ email, role: "owner", status: "pending" });
    const welcome = sent.filter((e) => e.to === email);
    expect(welcome).toHaveLength(1);
    expect(welcome[0]!.subject).toContain("Habit Tracker");
    expect(welcome[0]!.text).toContain(body.urls.signUp);
    expect(welcome[0]!.text).toContain("App Builder");
  });

  it("is idempotent, keeps one owner's apps in one workspace, and keeps partners apart", async () => {
    const email = address("ike");
    const id = project();
    const first = (await (await put(id, { name: "One", owner: { email } })).json()) as any;
    const again = await put(id, { name: "One", owner: { email } });
    expect(again.status).toBe(200);
    expect(((await again.json()) as any).app.appId).toBe(first.app.appId);
    const second = (await (await put(project(), { name: "Two", owner: { email } })).json()) as any;
    expect(second.workspace.id).toBe(first.workspace.id);
    expect(second.app.appId).not.toBe(first.app.appId);
    expect(sent.filter((e) => e.to === email)).toHaveLength(1);

    expect((await put(id, { name: "One", owner: { email: address("someone") } })).status).toBe(409);
    expect((await partner(`/apps/${id}`, {}, OTHER_KEY)).status).toBe(404);
    expect((await put(id, { name: "Theirs", owner: { email } }, OTHER_KEY)).status).toBe(201);
  });

  it("validates the project ID and the owner", async () => {
    expect((await put("has space", { name: "X", owner: { email: address("v") } })).status).toBe(400);
    expect((await put(project(), { name: "X", owner: { email: "not-an-email" } })).status).toBe(400);
    expect((await put(project(), { name: "", owner: { email: address("v") } })).status).toBe(400);
  });
});

describe("the owner joining", () => {
  it("signs up with the invited address (sign-ups closed) straight into the workspace, as its owner", async () => {
    const email = address("olga");
    const id = project();
    const created = (await (await put(id, { name: "Plant Pal", owner: { email, name: "Olga" } })).json()) as any;

    const res = await signUpAs(email, "Olga Owner");
    expect(res.status).toBe(200);
    const cookie = cookieOf(res);
    const me = (await (await asUser(cookie, "/api/me")).json()) as any;
    expect(me.organization.id).toBe(created.workspace.id);
    // no empty workspace of their own next to it
    const memberships = await deps.db.select().from(members).where(eq(members.userId, me.user.id));
    expect(memberships.map((m) => [m.organizationId, m.role])).toEqual([[created.workspace.id, "owner"]]);
    const appsRes = (await (await asUser(cookie, "/api/apps")).json()) as any;
    expect(appsRes.apps.map((a: any) => a.publicId)).toEqual([created.app.appId]);
    expect(await deps.billing.isActive(created.workspace.id)).toBe(true);

    const now = (await (await partner(`/apps/${id}`)).json()) as any;
    expect(now.owner).toMatchObject({ status: "member", invitationExpiresAt: null });
    expect(now.urls.signUp).toBeNull();
    const audit = await deps.db.select().from(auditEvents).where(eq(auditEvents.organizationId, created.workspace.id));
    expect(audit.map((a) => a.action).sort()).toEqual(["member.added", "partner.app_created"]);
  });

  it("adds an owner who already has an account at once, and tells them where to sign in", async () => {
    const email = address("ezra");
    await deps.db.insert(betaInvites).values({ email, until: new Date(Date.now() + 86_400_000) });
    expect((await signUpAs(email, "Ezra Existing")).status).toBe(200);
    const res = (await (await put(project(), { name: "Recipe Box", owner: { email } })).json()) as any;
    expect(res.owner.status).toBe("member");
    const welcome = sent.filter((e) => e.to === email);
    expect(welcome).toHaveLength(1);
    expect(welcome[0]!.text).toContain("/sign-in?next=%2Finbox");
  });

  it("renews an expired invitation on the next PUT", async () => {
    const email = address("eve");
    const id = project();
    const created = (await (await put(id, { name: "Late", owner: { email } })).json()) as any;
    await deps.db.update(invitations).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(invitations.organizationId, created.workspace.id));
    expect(((await (await partner(`/apps/${id}`)).json()) as any).owner.status).toBe("expired");
    // an expired invitation doesn't open sign-up
    expect((await signUpAs(email)).status).toBe(403);
    const renewed = (await (await put(id, { name: "Late", owner: { email } })).json()) as any;
    expect(renewed.owner.status).toBe("invited");
    expect(sent.filter((e) => e.to === email)).toHaveLength(2);
    expect((await signUpAs(email)).status).toBe(200);
  });
});

describe("push and deletion", () => {
  it("takes the APNs key, never returning it", async () => {
    const id = project();
    await put(id, { name: "Pushy", owner: { email: address("pat") } });
    const key = generateP8();
    const res = await partner(`/apps/${id}/push`, { method: "PUT", json: { teamId: "TEAM123456", keyId: "KEY1234567", bundleId: "com.example.pushy", p8: key.p8 } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.push).toEqual({ configured: true, bundleId: "com.example.pushy", issue: null });
    expect(JSON.stringify(body)).not.toContain("PRIVATE KEY");
    const bad = await partner(`/apps/${id}/push`, { method: "PUT", json: { teamId: "TEAM123456", keyId: "KEY1234567", bundleId: "com.example.pushy", p8: "nope" } });
    expect(((await bad.json()) as any).error.code).toBe("invalid_push_key");
    expect((await partner(`/apps/${project()}/push`, { method: "PUT", json: { teamId: "TEAM123456", keyId: "KEY1234567", bundleId: "a.b" } })).status).toBe(404);
  });

  it("deletes the app; the project ID then makes a new one", async () => {
    const email = address("dan");
    const id = project();
    const created = (await (await put(id, { name: "Gone", owner: { email } })).json()) as any;
    expect((await partner(`/apps/${id}`, { method: "DELETE" })).status).toBe(204);
    expect((await partner(`/apps/${id}`)).status).toBe(404);
    const res = await app.request("/v1/devices", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ appId: created.app.appId, device: { model: "iPhone16,1" } }),
    });
    expect(res.status).toBe(404);
    const again = (await (await put(id, { name: "Back", owner: { email } })).json()) as any;
    expect(again.app.appId).not.toBe(created.app.appId);
    expect(again.workspace.id).toBe(created.workspace.id);
    const links = await deps.db.select().from(partnerApps).where(and(eq(partnerApps.partner, "app-builder"), eq(partnerApps.externalId, id)));
    expect(links).toHaveLength(1);
  });
});
