/* eslint-disable @typescript-eslint/no-explicit-any -- response bodies are asserted on, not typed */
import { randomBytes } from "node:crypto";
import { betaAccess, betaInvites } from "@hshelby/db";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { makeTestApp, ORIGIN, signUp } from "./helpers";

// the closed beta: sign-ups only for invited addresses
const { app, deps, close } = await makeTestApp({}, { SIGNUPS: "invite" });
afterAll(close);

const address = (name: string) => `${name}-${randomBytes(4).toString("hex")}@example.com`;
const signUpAs = (email: string) =>
  app.request("/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN },
    body: JSON.stringify({ name: "Bea Tester", email, password: "correct horse battery" }),
  });

describe("invite-only sign-ups", () => {
  it("turn away an address without an invite, with a message to ask for one", async () => {
    const res = await signUpAs(address("stranger"));
    expect(res.status).toBe(403);
    expect(((await res.json()) as any).message).toMatch(/closed beta/);
  });

  it("let an invited address in, and its workspace gets beta access until the invite's date", async () => {
    const email = address("bea");
    const until = new Date(Date.now() + 30 * 86_400_000);
    await deps.db.insert(betaInvites).values({ email, until, note: "first tester" });
    const res = await signUpAs(email.toUpperCase());
    expect(res.status).toBe(200);

    const cookie = res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
    const { organization } = (await (await app.request("/api/me", { headers: { cookie, origin: ORIGIN } })).json()) as any;
    const [access] = await deps.db.select().from(betaAccess).where(eq(betaAccess.organizationId, organization.id));
    expect(access).toMatchObject({ until, note: "first tester" });
    const [invite] = await deps.db.select().from(betaInvites).where(eq(betaInvites.email, email));
    expect(invite!.usedAt).toBeInstanceOf(Date);
  });

  it("refuse an expired invite", async () => {
    const email = address("late");
    await deps.db.insert(betaInvites).values({ email, until: new Date(Date.now() - 1000) });
    expect((await signUpAs(email)).status).toBe(403);
  });

  it("let a teammate with a pending invitation to a workspace sign up", async () => {
    const ownerEmail = address("owner");
    await deps.db.insert(betaInvites).values({ email: ownerEmail, until: new Date(Date.now() + 86_400_000) });
    const res = await signUpAs(ownerEmail);
    const cookie = res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
    const owner = (path: string, body: unknown) =>
      app.request(path, { method: "POST", headers: { cookie, origin: ORIGIN, "content-type": "application/json" }, body: JSON.stringify(body) });
    const teammate = address("teammate");
    expect((await owner("/api/auth/organization/invite-member", { email: teammate, role: "member" })).status).toBe(200);
    expect((await signUpAs(teammate)).status).toBe(200);
  });
});

describe("open sign-ups", () => {
  it("are the default", async () => {
    const open = await makeTestApp();
    await expect(signUp(open.app, "Olga Open")).resolves.toBeTruthy();
    await open.close();
  });
});
