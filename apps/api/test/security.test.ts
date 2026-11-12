/* eslint-disable @typescript-eslint/no-explicit-any -- response bodies are asserted on, not typed */
import { randomBytes } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { startFakeStripe } from "@hshelby/billing/testing";
import { aiRuns, aiUsage, apps, conversations, partnerWorkspaces } from "@hshelby/db";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { considerMessage } from "../src/ai/consider";
import { aiProvider } from "../src/ai/provider";
import { startFakeAnthropic, toolUse } from "./fake-anthropic";
import { joinAsMember, makeTestApp, ORIGIN, registerDevice, signUp, workspaceWithApp } from "./helpers";

/*
 * Regression tests for the security review's findings: each one is the review's reproduction with the outcome it
 * must now have.
 */

const KEY = randomBytes(32).toString("hex");
const stripe = await startFakeStripe({
  prices: { price_month: { amount: 2500, interval: "month" }, price_year: { amount: 20000, interval: "year" } },
  webhookSecret: "whsec_security",
  deliver: async () => {},
});
const fake = await startFakeAnthropic();
// a partner deployment: billing on, sign-ups by invite, and low AI ceilings so the tests reach them
const { app, deps, close } = await makeTestApp(
  { stripe: stripe.client(), ai: aiProvider("anthropic", new Anthropic({ apiKey: "test-key", baseURL: fake.url, maxRetries: 0 })) },
  {
    SIGNUPS: "invite",
    PARTNER_API_KEY: KEY,
    STRIPE_SECRET_KEY: "sk_test_fake",
    STRIPE_WEBHOOK_SECRET: "whsec_security",
    STRIPE_PRICE_MONTHLY: "price_month",
    STRIPE_PRICE_YEARLY: "price_year",
    AI_APP_DAILY_REPLIES: "2",
    AI_WORKSPACE_DAILY_PREVIEWS: "2",
  },
);
// open sign-ups and no billing, for the team's own invitations
const open = await makeTestApp({ mailer: { enabled: true, send: async () => {} } as any });
afterAll(async () => {
  await Promise.all([close(), open.close()]);
  await Promise.all([stripe.close(), fake.close()]);
});

const partner = (path: string, init: { method?: string; json?: unknown } = {}) =>
  app.request(`/partner/v1${path}`, {
    method: init.method ?? "GET",
    headers: { authorization: `Bearer ${KEY}`, ...(init.json !== undefined && { "content-type": "application/json" }) },
    ...(init.json !== undefined && { body: JSON.stringify(init.json) }),
  });
const id = (prefix: string) => `${prefix}_${randomBytes(6).toString("hex")}`;
const address = (name: string) => `${name}-${randomBytes(4).toString("hex")}@example.com`;
const claimLink = async (workspace: string) => {
  const { url } = (await (await partner(`/workspaces/${workspace}/claim-link`, { method: "POST" })).json()) as any;
  return (url as string).split("/claim/")[1]!;
};

async function signUpAs(email: string) {
  const res = await app.request("/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN },
    body: JSON.stringify({ name: "Olive Owner", email, password: "correct horse battery" }),
  });
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  const call = (path: string, init: RequestInit = {}) =>
    app.request(path, { ...init, headers: { cookie, origin: ORIGIN, "content-type": "application/json", ...(init.headers ?? {}) } });
  return { status: res.status, call };
}

/** A partner workspace with one app, claimed by its owner, with AI replies on. */
async function claimedWorkspace() {
  const workspace = id("user");
  const project = id("proj");
  const email = address("olive");
  await partner(`/workspaces/${workspace}`, { method: "PUT", json: { name: "Olive's apps", ownerEmail: email } });
  const { app: created } = (await (await partner(`/workspaces/${workspace}/apps/${project}`, { method: "PUT", json: { name: "Habit Tracker" } })).json()) as any;
  // sign-ups are by invite: the claim link is what lets the owner in
  const link = await claimLink(workspace);
  const owner = await signUpAs(email);
  expect(owner.status).toBe(200);
  expect((await owner.call(`/api/partner-claims/${link}/accept`, { method: "POST" })).status).toBe(200);
  const [row] = await deps.db.select({ id: apps.id }).from(apps).where(eq(apps.publicId, created.appId));
  const settings = { enabled: true, name: "Assistant", instructions: "", docs: "Help.", allowOffers: false, allowReviews: false };
  expect((await owner.call(`/api/apps/${row!.id}/ai`, { method: "PUT", body: JSON.stringify(settings) })).status).toBe(200);
  return { workspace, project, publicId: created.appId as string, appId: row!.id, call: owner.call };
}

/** The usage feed lists a call about 10 seconds after it's written; tests don't wait. */
const settle = () => deps.db.update(aiUsage).set({ createdAt: new Date(Date.now() - 60_000) });
const usageOf = async (workspace: string) =>
  ((await (await partner("/usage?limit=500")).json()) as any).items.filter((i: any) => i.workspaceExternalId === workspace);

async function consentingDevice(publicId: string) {
  const device = await registerDevice(app, publicId);
  expect((await device.sdk("/v1/ai-consent", { json: { consent: "granted" } })).status).toBe(200);
  const turn = async (text: string) => {
    const sent = (await (await device.send(text)).json()) as any;
    return considerMessage(deps, { conversationId: sent.conversation.id, messageId: sent.message.id });
  };
  return { ...device, turn };
}

describe("partner claim links", () => {
  it("stop working for an address the partner replaced as owner", async () => {
    const workspace = id("user");
    const [oldEmail, newEmail] = [address("old"), address("new")];
    await partner(`/workspaces/${workspace}`, { method: "PUT", json: { name: "Dummy", ownerEmail: oldEmail } });
    const oldLink = await claimLink(workspace);
    expect((await partner(`/workspaces/${workspace}`, { method: "PATCH", json: { ownerEmail: newEmail } })).status).toBe(200);

    // the old link is gone, and no longer opens the closed sign-up for the old address
    expect((await app.request(`/api/partner-claims/${oldLink}`)).status).toBe(404);
    expect((await signUpAs(oldEmail)).status).toBe(403);

    const newLink = await claimLink(workspace);
    const owner = await signUpAs(newEmail);
    expect(owner.status).toBe(200);
    expect((await owner.call(`/api/partner-claims/${newLink}/accept`, { method: "POST" })).status).toBe(200);
  });

  it("stop working for a replaced owner who already has an account, and when PUT names the new owner", async () => {
    const workspace = id("user");
    const [oldEmail, newEmail] = [address("old"), address("new")];
    await partner(`/workspaces/${workspace}`, { method: "PUT", json: { name: "Dummy", ownerEmail: oldEmail } });
    const oldLink = await claimLink(workspace);
    const old = await signUpAs(oldEmail);
    expect(old.status).toBe(200);
    await partner(`/workspaces/${workspace}`, { method: "PUT", json: { name: "Dummy", ownerEmail: newEmail } });
    expect((await old.call(`/api/partner-claims/${oldLink}/accept`, { method: "POST" })).status).toBe(404);
  });

  it("all stop working once the owner has joined with one of them", async () => {
    const workspace = id("user");
    const email = address("olive");
    await partner(`/workspaces/${workspace}`, { method: "PUT", json: { name: "Dummy", ownerEmail: email } });
    const [first, second] = [await claimLink(workspace), await claimLink(workspace)];
    const owner = await signUpAs(email);
    expect((await owner.call(`/api/partner-claims/${first}/accept`, { method: "POST" })).status).toBe(200);
    expect((await app.request(`/api/partner-claims/${second}`)).status).toBe(404);
    expect(((await (await app.request(`/api/partner-claims/${first}`)).json()) as any).status).toBe("used");
  });
});

describe("pending invitations", () => {
  it("are listed to owners and admins only, so a member can't take one over", async () => {
    const owner = await workspaceWithApp(open.app, "Olive Owner");
    const member = await joinAsMember(open.app, open.deps, owner.call);
    const invited = address("new-admin");
    const invite = await owner.call("/api/auth/organization/invite-member", { method: "POST", body: JSON.stringify({ email: invited, role: "admin" }) });
    expect(invite.status).toBe(200);
    const { id: invitationId } = (await invite.json()) as any;

    expect((await member.call("/api/auth/organization/list-invitations")).status).toBe(403);
    const asMember = (await (await member.call("/api/auth/organization/get-full-organization")).json()) as any;
    expect(asMember.members.length).toBe(2);
    expect(asMember.invitations).toEqual([]);
    expect(JSON.stringify(asMember)).not.toContain(invitationId);

    // the people who invite still see them
    const listed = (await (await owner.call("/api/auth/organization/list-invitations")).json()) as any[];
    expect(listed.map((i) => i.id)).toContain(invitationId);
    const asOwner = (await (await owner.call("/api/auth/organization/get-full-organization")).json()) as any;
    expect(asOwner.invitations.map((i: any) => i.id)).toContain(invitationId);

    // and the invited person still joins
    const invitee = await signUp(open.app, "Ian Invitee");
    const other = await owner.call("/api/auth/organization/invite-member", { method: "POST", body: JSON.stringify({ email: invitee.email, role: "member" }) });
    const accepted = await invitee.call("/api/auth/organization/accept-invitation", { method: "POST", body: JSON.stringify({ invitationId: ((await other.json()) as any).id }) });
    expect(accepted.status).toBe(200);
  });
});

describe("what the AI may cost", () => {
  it("has a ceiling per app that another device, or deleting one, doesn't reset", async () => {
    const team = await claimedWorkspace();
    fake.respond(() => toolUse("reply", { text: "ok" }));
    const start = fake.requests.length;
    const first = await consentingDevice(team.publicId);
    expect(await first.turn("one")).toBe("replied");
    const second = await consentingDevice(team.publicId);
    expect(await second.turn("two")).toBe("replied");
    expect(fake.requests.length - start).toBe(2);

    // the app's two answers for the day are used: a third device goes to the team, without a model call
    const third = await consentingDevice(team.publicId);
    expect(await third.turn("three")).toBe("limit");
    expect(fake.requests.length - start).toBe(2);
    const handedOver = await deps.db.select({ id: conversations.id }).from(conversations).where(and(eq(conversations.appId, team.appId), eq(conversations.aiState, "handed_over")));
    expect(handedOver).toHaveLength(1);

    // deleting the first device removes its run, not what it cost
    expect((await first.sdk("/v1/device", { method: "DELETE" })).status).toBe(200);
    const [runs] = await deps.db.select({ n: sql<number>`count(*)::int` }).from(aiRuns).where(eq(aiRuns.appId, team.appId));
    expect(runs!.n).toBeLessThan(3);
    const fourth = await consentingDevice(team.publicId);
    expect(await fourth.turn("four")).toBe("limit");
    expect(fake.requests.length - start).toBe(2);
  });

  it("stays in the partner's usage feed after the conversation, device and app are deleted", async () => {
    const team = await claimedWorkspace();
    fake.respond(() => toolUse("reply", { text: "ok" }));
    const device = await consentingDevice(team.publicId);
    expect(await device.turn("hello")).toBe("replied");
    await settle();
    const before = await usageOf(team.workspace);
    expect(before).toHaveLength(1);
    expect(before[0].appExternalId).toBe(team.project);
    expect(before[0].costUsd).toBeGreaterThan(0);

    expect((await device.sdk("/v1/device", { method: "DELETE" })).status).toBe(200);
    expect(await usageOf(team.workspace)).toEqual(before);
    // the project's app is deleted and made again: the call still belongs to the project
    expect((await partner(`/workspaces/${team.workspace}/apps/${team.project}`, { method: "DELETE" })).status).toBe(204);
    await partner(`/workspaces/${team.workspace}/apps/${team.project}`, { method: "PUT", json: { name: "Habit Tracker" } });
    expect(await usageOf(team.workspace)).toEqual(before);
  });
});

describe("AI preview", () => {
  const preview = (call: Awaited<ReturnType<typeof claimedWorkspace>>["call"], appId: string) =>
    call(`/api/apps/${appId}/ai/preview`, { method: "POST", body: JSON.stringify({ messages: [{ sender: "user", text: "How do I export?" }] }) });

  it("passes the gates a real answer does", async () => {
    const team = await claimedWorkspace();
    fake.respond(() => toolUse("reply", { text: "ok" }));
    const start = fake.requests.length;
    const setWorkspace = (values: { active?: boolean; aiAllowed?: boolean }) =>
      partner(`/workspaces/${team.workspace}`, { method: "PATCH", json: values });

    await setWorkspace({ aiAllowed: false });
    const off = await preview(team.call, team.appId);
    expect([off.status, ((await off.json()) as any).error.code]).toEqual([409, "ai_unavailable"]);
    await setWorkspace({ aiAllowed: true, active: false });
    const inactive = await preview(team.call, team.appId);
    expect([inactive.status, ((await inactive.json()) as any).error.code]).toEqual([402, "subscription_inactive"]);
    expect(fake.requests.length - start).toBe(0);
    expect((await deps.db.select().from(partnerWorkspaces).where(eq(partnerWorkspaces.externalId, team.workspace)))[0]!.active).toBe(false);
  });

  it("is recorded, billed to the partner, and capped per workspace per day", async () => {
    const team = await claimedWorkspace();
    fake.respond(() => toolUse("reply", { text: "ok" }));
    const start = fake.requests.length;
    expect((await preview(team.call, team.appId)).status).toBe(200);
    expect((await preview(team.call, team.appId)).status).toBe(200);
    const third = await preview(team.call, team.appId);
    expect([third.status, ((await third.json()) as any).error.code]).toEqual([429, "rate_limited"]);
    expect(fake.requests.length - start).toBe(2);

    const recorded = await deps.db.select().from(aiUsage).where(eq(aiUsage.appId, team.appId));
    expect(recorded.map((r) => r.kind)).toEqual(["preview", "preview"]);
    await settle();
    expect(await usageOf(team.workspace)).toHaveLength(2);
    const overview = (await (await team.call(`/api/apps/${team.appId}/ai`)).json()) as any;
    expect(overview.last30Days.usage.inputTokens).toBeGreaterThan(0);
    // previews don't use up the app's answers
    const device = await consentingDevice(team.publicId);
    expect(await device.turn("hello")).toBe("replied");
  });
});
