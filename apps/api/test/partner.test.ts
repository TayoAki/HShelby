/* eslint-disable @typescript-eslint/no-explicit-any -- response bodies are asserted on, not typed */
import { randomBytes } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { startFakeStripe } from "@hshelby/billing/testing";
import { uuidv7 } from "@hshelby/core";
import { aiRuns, apps, auditEvents, betaInvites, members, organizations, partnerClaims, partnerWorkspaces, users } from "@hshelby/db";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { considerMessage } from "../src/ai/consider";
import { aiProvider } from "../src/ai/provider";
import { startFakeAnthropic, toolUse } from "./fake-anthropic";
import { makeTestApp, ORIGIN, registerDevice, reply } from "./helpers";

const KEY = randomBytes(32).toString("hex");
const OTHER_KEY = randomBytes(32).toString("hex");
const stripe = await startFakeStripe({
  prices: { price_month: { amount: 2500, interval: "month" }, price_year: { amount: 20000, interval: "year" } },
  webhookSecret: "whsec_partner",
  deliver: async () => {},
});
const fakeAi = await startFakeAnthropic();
// billing on (Stripe test mode) and sign-ups invite-only, as in production
const { app, deps, close } = await makeTestApp(
  { stripe: stripe.client(), ai: aiProvider("anthropic", new Anthropic({ apiKey: "test-key", baseURL: fakeAi.url, maxRetries: 0 })) },
  {
    SIGNUPS: "invite",
    PARTNER_API_KEY: KEY,
    STRIPE_SECRET_KEY: "sk_test_fake",
    STRIPE_WEBHOOK_SECRET: "whsec_partner",
    STRIPE_PRICE_MONTHLY: "price_month",
    STRIPE_PRICE_YEARLY: "price_year",
  },
);
// another partner on the same database, and a deployment without a partner key
const other = await makeTestApp({}, { PARTNER_API_KEY: OTHER_KEY, PARTNER_NAME: "otherbuilder" });
const keyless = await makeTestApp();
afterAll(async () => {
  await Promise.all([close(), other.close(), keyless.close()]);
  await Promise.all([stripe.close(), fakeAi.close()]);
});

type App = typeof app;
const partner = (path: string, init: { method?: string; json?: unknown } = {}, key = KEY, target: App = app) =>
  target.request(`/partner/v1${path}`, {
    method: init.method ?? "GET",
    headers: { authorization: `Bearer ${key}`, ...(init.json !== undefined && { "content-type": "application/json" }) },
    ...(init.json !== undefined && { body: JSON.stringify(init.json) }),
  });
const id = (prefix: string) => `${prefix}_${randomBytes(6).toString("hex")}`;
const address = (name: string) => `${name}-${randomBytes(4).toString("hex")}@example.com`;
const putWorkspace = (externalId: string, ownerEmail: string, name = "Olive's apps") =>
  partner(`/workspaces/${externalId}`, { method: "PUT", json: { name, ownerEmail } });
const putApp = (workspace: string, project: string, json: unknown) => partner(`/workspaces/${workspace}/apps/${project}`, { method: "PUT", json });
const orgOf = async (externalId: string, name = "appbuilder") =>
  (await deps.db.select().from(partnerWorkspaces).where(eq(partnerWorkspaces.externalId, externalId))).find((w) => w.partner === name)!;

/** Signs up with an address (sign-ups are invite-only here) and returns a cookie-carrying fetch. */
async function signUpAs(email: string, name = "Olive Owner") {
  const res = await app.request("/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN },
    body: JSON.stringify({ name, email, password: "correct horse battery" }),
  });
  const cookie = res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  const call = (path: string, init: RequestInit = {}) =>
    app.request(path, { ...init, headers: { cookie, origin: ORIGIN, "content-type": "application/json", ...(init.headers ?? {}) } });
  return { res, call };
}

const tokenOf = (url: string) => url.split("/claim/")[1]!;

/** A partner workspace whose owner claimed it, with one partner app. */
async function claimedWorkspace() {
  const workspace = id("user");
  const email = address("olive");
  await putWorkspace(workspace, email);
  const project = id("proj");
  const { app: created } = (await (await putApp(workspace, project, { name: "Habit Tracker" })).json()) as any;
  const { url } = (await (await partner(`/workspaces/${workspace}/claim-link`, { method: "POST" })).json()) as any;
  const owner = await signUpAs(email);
  expect(owner.res.status).toBe(200);
  expect((await owner.call(`/api/partner-claims/${tokenOf(url)}/accept`, { method: "POST" })).status).toBe(200);
  return { workspace, project, email, owner, publicId: created.appId as string };
}

describe("keys", () => {
  it("are required: a missing or wrong key is 401, and without a key configured the routes don't exist", async () => {
    expect((await app.request("/partner/v1/usage")).status).toBe(401);
    expect((await partner("/usage", {}, "wrong")).status).toBe(401);
    expect((await partner("/usage", {}, KEY.slice(0, -1) + "0")).status).toBe(401);
    expect((await partner("/usage")).status).toBe(200);
    const res = await partner("/usage", {}, KEY, keyless.app);
    expect(res.status).toBe(404);
    expect(((await res.json()) as any).error.code).toBe("not_found");
  });
});

describe("workspaces and apps", () => {
  it("are upserted idempotently, with audit events", async () => {
    const workspace = id("user");
    const email = address("ike");
    const created = await putWorkspace(workspace, email.toUpperCase());
    expect(created.status).toBe(201);
    expect(await created.json()).toEqual({ workspace: { externalId: workspace, active: true, aiAllowed: true, claimed: false, dashboardUrl: ORIGIN } });
    const again = await putWorkspace(workspace, email, "Ike's apps");
    expect(again.status).toBe(200);
    const row = await orgOf(workspace);
    expect(row.ownerEmail).toBe(email);
    const [org] = await deps.db.select().from(organizations).where(eq(organizations.id, row.organizationId));
    expect(org!.name).toBe("Ike's apps");
    expect(await deps.db.select().from(members).where(eq(members.organizationId, row.organizationId))).toHaveLength(0);

    const project = id("proj");
    const first = await putApp(workspace, project, { name: "Habit Tracker", bundleId: "com.example.habit" });
    expect(first.status).toBe(201);
    const body = (await first.json()) as any;
    expect(body.app).toMatchObject({ externalId: project, name: "Habit Tracker" });
    expect(body.app.appId).toMatch(/^app_[0-9A-Za-z]{22}$/);
    const renamed = await putApp(workspace, project, { name: "Habit Hero" });
    expect(renamed.status).toBe(200);
    expect(await renamed.json()).toEqual({ app: { externalId: project, appId: body.app.appId, name: "Habit Hero" } });
    // the SDK works with it at once
    const device = await registerDevice(app, body.app.appId);
    expect((await device.send("Hello?")).status).toBe(201);

    const audit = await deps.db.select().from(auditEvents).where(eq(auditEvents.organizationId, row.organizationId));
    expect(audit.map((a) => a.action).sort()).toEqual(["partner.app.created", "partner.workspace.created"]);

    // deleting is idempotent, and the project then gets a new app
    expect((await partner(`/workspaces/${workspace}/apps/${project}`, { method: "DELETE" })).status).toBe(204);
    expect((await partner(`/workspaces/${workspace}/apps/${project}`, { method: "DELETE" })).status).toBe(204);
    expect((await device.send("Still there?")).status).toBe(401);
    const recreated = (await (await putApp(workspace, project, { name: "Habit Hero" })).json()) as any;
    expect(recreated.app.appId).not.toBe(body.app.appId);

    expect((await putApp(id("nobody"), id("proj"), { name: "X" })).status).toBe(404);
    expect((await putWorkspace("has space", email)).status).toBe(400);
    expect((await putWorkspace(id("user"), "not-an-email")).status).toBe(400);
  });

  it("can add apps and reply without a Stripe subscription, and say so on the billing page", async () => {
    const { owner, publicId } = await claimedWorkspace();
    // a second app needs a subscription in an ordinary workspace
    for (const name of ["Second", "Third"]) {
      expect((await owner.call("/api/apps", { method: "POST", body: JSON.stringify({ name }) })).status).toBe(201);
    }
    const device = await registerDevice(app, publicId);
    const sent = (await (await device.send("Help")).json()) as any;
    expect((await reply(owner.call, sent.conversation.id, "Here to help")).status).toBe(201);
    expect(await (await owner.call("/api/billing")).json()).toMatchObject({
      enabled: true,
      active: true,
      offer: null,
      subscription: null,
      partner: { name: "App Builder", active: true },
    });
  });

  it("locks replies like an unpaid workspace when the partner marks it inactive", async () => {
    const { workspace, owner, publicId } = await claimedWorkspace();
    // the app's first conversation is its setup conversation, which stays open; use a second person's
    await (await registerDevice(app, publicId)).send("setup test");
    const sent = (await (await (await registerDevice(app, publicId)).send("Hi")).json()) as any;

    const off = await partner(`/workspaces/${workspace}`, { method: "PATCH", json: { active: false } });
    expect(((await off.json()) as any).workspace).toMatchObject({ active: false, claimed: true });
    const locked = await reply(owner.call, sent.conversation.id, "Hello");
    expect(locked.status).toBe(402);
    expect(((await locked.json()) as any).error.code).toBe("subscription_inactive");
    expect(await (await owner.call("/api/billing")).json()).toMatchObject({ active: false, partner: { active: false } });

    await partner(`/workspaces/${workspace}`, { method: "PATCH", json: { active: true } });
    expect((await reply(owner.call, sent.conversation.id, "Hello again")).status).toBe(201);
  });

  it("stops AI replies when the partner turns them off; the team still gets the message", async () => {
    const { workspace, owner, publicId } = await claimedWorkspace();
    const appRow = (await (await owner.call("/api/apps")).json()) as any;
    const appId = appRow.apps.find((a: any) => a.publicId === publicId).id;
    const settings = { enabled: true, name: "Assistant", instructions: "", docs: "Help.", allowOffers: false, allowReviews: false };
    expect((await owner.call(`/api/apps/${appId}/ai`, { method: "PUT", body: JSON.stringify(settings) })).status).toBe(200);
    const device = await registerDevice(app, publicId);
    expect((await device.sdk("/v1/ai-consent", { json: { consent: "granted" } })).status).toBe(200);

    await partner(`/workspaces/${workspace}`, { method: "PATCH", json: { aiAllowed: false } });
    const sent = (await (await device.send("How do I start?")).json()) as any;
    const job = { conversationId: sent.conversation.id, messageId: sent.message.id };
    const before = fakeAi.requests.length;
    expect(await considerMessage(deps, job)).toBe("disabled");
    expect(fakeAi.requests.length).toBe(before);
    expect(((await (await device.sdk("/v1/conversation")).json()) as any).ai.enabled).toBe(false);
    const inbox = (await (await owner.call(`/api/conversations/${sent.conversation.id}`)).json()) as any;
    expect(inbox.conversation.unreadForTeam).toBe(1);

    await partner(`/workspaces/${workspace}`, { method: "PATCH", json: { aiAllowed: true } });
    fakeAi.respond(() => toolUse("reply", { text: "Tap Start." }));
    expect(await considerMessage(deps, job)).toBe("replied");
  });
});

describe("usage", () => {
  it("lists the partner's AI runs that called the model, priced, a page at a time", async () => {
    const { workspace, project, publicId } = await claimedWorkspace();
    const sent = (await (await (await registerDevice(app, publicId)).send("Hi")).json()) as any;
    const [appRow] = await deps.db.select({ id: apps.id }).from(apps).where(eq(apps.publicId, publicId));
    // earlier tests' runs come before this cursor (ids are time-ordered)
    const start = uuidv7();
    const ids: string[] = [];
    const run = async (tokens: Partial<Record<"inputTokens" | "outputTokens" | "cacheReadTokens" | "cacheWriteTokens", number>>, model: string | null = null) => {
      const runId = uuidv7();
      await deps.db.insert(aiRuns).values({ id: runId, appId: appRow!.id, conversationId: sent.conversation.id, outcome: "replied", model, ...tokens });
      ids.push(runId);
    };
    await run({ inputTokens: 1_000_000, outputTokens: 100_000, cacheReadTokens: 1_000_000, cacheWriteTokens: 200_000 });
    await run({ outputTokens: 50_000 }, "anthropic/claude-opus-5.5");
    await run({}); // never called the model: left out
    await run({ inputTokens: 2_500 }, "claude-opus-5-5");

    const items: any[] = [];
    let after: string | null = start;
    for (let page = 0; page < 10 && after; page++) {
      const res = (await (await partner(`/usage?limit=2&after=${after}`)).json()) as any;
      expect(res.items.length).toBeLessThanOrEqual(2);
      items.push(...res.items);
      after = res.next;
    }
    expect(items.map((i) => i.id)).toEqual([ids[0], ids[1], ids[3]]);
    // $4 / $20 / $0.20 / $5 per million input, output, cache-read and cache-write tokens
    expect(items.map((i) => i.costUsd)).toEqual([7.2, 1, 0.01]);
    expect(items[0]).toMatchObject({ workspaceExternalId: workspace, appExternalId: project });
    expect(Date.now() - new Date(items[0].createdAt).getTime()).toBeLessThan(60_000);
    expect(await (await partner(`/usage?after=${ids[3]}`)).json()).toEqual({ items: [], next: null });
    expect((await partner("/usage?limit=501")).status).toBe(400);
    // the other partner doesn't see them
    const theirs = (await (await partner(`/usage?limit=500&after=${start}`, {}, OTHER_KEY, other.app)).json()) as any;
    expect(theirs.items).toEqual([]);
  });
});

describe("claiming", () => {
  it("lets the owner sign up with the link while sign-ups are closed, and join as owner without a workspace of their own", async () => {
    const workspace = id("user");
    const email = address("cleo");
    await putWorkspace(workspace, email, "Cleo's apps");
    // no claim yet: sign-ups are closed to this address
    expect((await signUpAs(email)).res.status).toBe(403);
    const { url } = (await (await partner(`/workspaces/${workspace}/claim-link`, { method: "POST" })).json()) as any;
    expect(url).toMatch(new RegExp(`^${ORIGIN}/claim/[A-Za-z0-9_-]{43}$`));
    const token = tokenOf(url);
    expect(await (await app.request(`/api/partner-claims/${token}`)).json()).toEqual({
      email,
      workspaceName: "Cleo's apps",
      partnerName: "App Builder",
      status: "valid",
    });

    const owner = await signUpAs(email, "Cleo Owner");
    expect(owner.res.status).toBe(200);
    // no empty workspace of their own: the claim is where they belong
    const joined = await deps.db.select().from(members).innerJoin(users, eq(users.id, members.userId)).where(eq(users.email, email));
    expect(joined).toHaveLength(0);

    // someone else can't use it
    const strangerEmail = address("stranger");
    await deps.db.insert(betaInvites).values({ email: strangerEmail, until: new Date(Date.now() + 86_400_000) });
    const stranger = await signUpAs(strangerEmail, "Stan Stranger");
    expect((await stranger.call(`/api/partner-claims/${token}/accept`, { method: "POST" })).status).toBe(403);

    const accepted = await owner.call(`/api/partner-claims/${token}/accept`, { method: "POST" });
    expect(accepted.status).toBe(200);
    const { organizationId } = (await accepted.json()) as any;
    expect(organizationId).toBe((await orgOf(workspace)).organizationId);
    const after = (await (await owner.call("/api/me")).json()) as any;
    expect(after.organization.id).toBe(organizationId);
    const memberships = await deps.db.select().from(members).where(eq(members.organizationId, organizationId));
    expect(memberships.map((m) => m.role)).toEqual(["owner"]);

    // the link is spent; the partner now gets the dashboard instead of a link
    expect((await owner.call(`/api/partner-claims/${token}/accept`, { method: "POST" })).status).toBe(403);
    expect(((await (await app.request(`/api/partner-claims/${token}`)).json()) as any).status).toBe("used");
    expect(await (await partner(`/workspaces/${workspace}/claim-link`, { method: "POST" })).json()).toEqual({ url: ORIGIN });
    expect(((await (await putWorkspace(workspace, email, "Cleo's apps")).json()) as any).workspace.claimed).toBe(true);
  });

  it("refuses an expired link", async () => {
    const workspace = id("user");
    const email = address("ed");
    await putWorkspace(workspace, email);
    const { url } = (await (await partner(`/workspaces/${workspace}/claim-link`, { method: "POST" })).json()) as any;
    await deps.db.update(partnerClaims).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(partnerClaims.email, email));
    expect(((await (await app.request(`/api/partner-claims/${tokenOf(url)}`)).json()) as any).status).toBe("expired");
    expect((await signUpAs(email)).res.status).toBe(403);
    expect((await app.request("/api/partner-claims/not-a-real-token-at-all-xx")).status).toBe(404);
  });
});

describe("partners", () => {
  it("can't touch each other's workspaces", async () => {
    const workspace = id("user");
    await putWorkspace(workspace, address("pia"));
    const theirs = { method: "PATCH", json: { active: false } };
    expect((await partner(`/workspaces/${workspace}`, theirs, OTHER_KEY, other.app)).status).toBe(404);
    expect((await partner(`/workspaces/${workspace}/apps/${id("proj")}`, { method: "PUT", json: { name: "X" } }, OTHER_KEY, other.app)).status).toBe(404);
    expect((await partner(`/workspaces/${workspace}/claim-link`, { method: "POST" }, OTHER_KEY, other.app)).status).toBe(404);
    // the same id is a different workspace for them
    const same = await partner(`/workspaces/${workspace}`, { method: "PUT", json: { name: "Theirs", ownerEmail: address("pia") } }, OTHER_KEY, other.app);
    expect(same.status).toBe(201);
    expect((await orgOf(workspace)).active).toBe(true);
    expect((await orgOf(workspace, "otherbuilder")).organizationId).not.toBe((await orgOf(workspace)).organizationId);
  });
});
