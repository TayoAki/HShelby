/* eslint-disable @typescript-eslint/no-explicit-any -- response bodies are asserted on, not typed */
import { randomBytes } from "node:crypto";
import { auditEvents, members } from "@hshelby/db";
import { and, eq } from "drizzle-orm";
import pino from "pino";
import { afterAll, describe, expect, it } from "vitest";
import { createMailer, type Email, type Mailer } from "../src/email";
import { makeTestApp, ORIGIN, signUp } from "./helpers";

const sent: Email[] = [];
const mailer: Mailer = { enabled: true, send: async (email) => void sent.push(email) };
const { app, deps, close } = await makeTestApp({ mailer });
afterAll(close);

const lastTo = (to: string) => sent.filter((e) => e.to === to).at(-1);
const linkIn = (email: Email) => email.text.match(/https?:\/\/\S+/)![0];
const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  app.request(path, { method: "POST", headers: { "content-type": "application/json", origin: ORIGIN, ...headers }, body: JSON.stringify(body) });

describe("password reset", () => {
  it("emails a one-hour link that opens the dashboard's page, changes the password and signs out other sessions", async () => {
    const user = await signUp(app, "Rita Reset");
    const res = await post("/api/auth/request-password-reset", { email: user.email, redirectTo: "/reset-password" });
    expect(res.status).toBe(200);
    const email = lastTo(user.email)!;
    expect(email.subject).toBe("Reset your Hire Shelby password");
    expect(email.html).toContain("Choose a new password");

    // the link checks the token and lands on the dashboard's page with it
    const link = new URL(linkIn(email));
    expect(link.origin).toBe(ORIGIN);
    const opened = await app.request(link.pathname + link.search);
    expect(opened.status).toBe(302);
    const landing = new URL(opened.headers.get("location")!, ORIGIN);
    expect(landing.pathname).toBe("/reset-password");
    const token = landing.searchParams.get("token")!;

    expect((await post("/api/auth/reset-password", { newPassword: "a brand new password", token })).status).toBe(200);
    // the old session is gone, the old password no longer works and the new one does
    expect((await user.call("/api/me")).status).toBe(401);
    expect((await post("/api/auth/sign-in/email", { email: user.email, password: "correct horse battery" })).status).toBe(401);
    expect((await post("/api/auth/sign-in/email", { email: user.email, password: "a brand new password" })).status).toBe(200);
    // a token works once
    expect((await post("/api/auth/reset-password", { newPassword: "yet another password", token })).status).toBe(400);
  });

  it("answers the same for an unknown address and sends nothing", async () => {
    const before = sent.length;
    const res = await post("/api/auth/request-password-reset", { email: `nobody-${randomBytes(4).toString("hex")}@example.com`, redirectTo: "/reset-password" });
    expect(res.status).toBe(200);
    expect(sent.length).toBe(before);
  });
});

describe("invitations", () => {
  it("email a link to the dashboard's accept page, and the invited address can join", async () => {
    const owner = await signUp(app, "Olive Owner");
    const { organization } = (await (await owner.call("/api/me")).json()) as any;
    const address = `teammate-${randomBytes(4).toString("hex")}@example.com`;
    const invited = await owner.call("/api/auth/organization/invite-member", {
      method: "POST",
      body: JSON.stringify({ email: address, role: "member", organizationId: organization.id }),
    });
    expect(invited.status).toBe(200);
    const invitationId = ((await invited.json()) as any).id as string;

    const email = lastTo(address)!;
    expect(email.subject).toBe(`Olive Owner invited you to ${organization.name} on Hire Shelby`);
    expect(linkIn(email)).toBe(`${ORIGIN}/accept-invitation/${invitationId}`);

    // someone else can't open it
    const stranger = await signUp(app, "Sam Stranger");
    expect((await stranger.call(`/api/auth/organization/get-invitation?id=${invitationId}`)).status).not.toBe(200);

    // the invited address signs up (getting its own workspace, as everyone does) and joins
    const res = await post("/api/auth/sign-up/email", { name: "Tim Teammate", email: address, password: "correct horse battery" });
    const cookie = res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
    const opened = await app.request(`/api/auth/organization/get-invitation?id=${invitationId}`, { headers: { cookie, origin: ORIGIN } });
    expect(opened.status).toBe(200);
    expect(await opened.json()).toMatchObject({ organizationName: organization.name, role: "member" });
    expect((await post("/api/auth/organization/accept-invitation", { invitationId }, { cookie })).status).toBe(200);
    const [joined] = await deps.db.select().from(members).where(and(eq(members.organizationId, organization.id), eq(members.role, "member")));
    expect(joined).toBeTruthy();
  });

  it("records a cancelled invitation in the audit log", async () => {
    const owner = await signUp(app, "Carl Cancel");
    const { organization } = (await (await owner.call("/api/me")).json()) as any;
    const invited = await owner.call("/api/auth/organization/invite-member", {
      method: "POST",
      body: JSON.stringify({ email: `later-${randomBytes(4).toString("hex")}@example.com`, role: "admin", organizationId: organization.id }),
    });
    const invitationId = ((await invited.json()) as any).id as string;
    expect((await owner.call("/api/auth/organization/cancel-invitation", { method: "POST", body: JSON.stringify({ invitationId }) })).status).toBe(200);
    const actions = await deps.db.select().from(auditEvents).where(eq(auditEvents.organizationId, organization.id));
    expect(actions.map((a) => a.action)).toEqual(expect.arrayContaining(["invitation.created", "invitation.canceled"]));
  });
});

describe("the Resend mailer", () => {
  const logger = pino({ level: "silent" });
  const env = { NODE_ENV: "production" as const, RESEND_API_KEY: "re_test", RESEND_API_URL: "https://resend.test", EMAIL_FROM: "Hire Shelby <hello@hireshelby.com>" };

  it("posts the message to Resend with the key and sender", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ id: "email_1" }), { status: 200 });
    }) as unknown as typeof fetch;
    await createMailer(env, logger, fetchImpl).send({ to: "a@example.com", subject: "Hi", text: "Hello", html: "<p>Hello</p>" });
    expect(calls[0]!.url).toBe("https://resend.test/emails");
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe("Bearer re_test");
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ from: env.EMAIL_FROM, to: ["a@example.com"], subject: "Hi", text: "Hello", html: "<p>Hello</p>" });
  });

  it("throws when Resend refuses, and sends nothing without a key", async () => {
    const refusing = (async () => new Response("domain not verified", { status: 403 })) as unknown as typeof fetch;
    await expect(createMailer(env, logger, refusing).send({ to: "a@example.com", subject: "Hi", text: "x", html: "x" })).rejects.toThrow("403");
    let called = false;
    const spy = (async () => {
      called = true;
      return new Response("{}");
    }) as unknown as typeof fetch;
    const keyless = createMailer({ ...env, RESEND_API_KEY: undefined }, logger, spy);
    expect(keyless.enabled).toBe(false);
    await keyless.send({ to: "a@example.com", subject: "Hi", text: "x", html: "x" });
    expect(called).toBe(false);
  });
});
