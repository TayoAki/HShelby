/* eslint-disable @typescript-eslint/no-explicit-any -- response bodies are asserted on, not typed */
import { apps, auditEvents } from "@hshelby/db";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { makeTestApp, ORIGIN, signUp } from "./helpers";

const { app, deps, close } = await makeTestApp();
afterAll(close);

describe("health and auth", () => {
  it("reports health", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    expect(await res.json() as any).toEqual({ ok: true });
  });

  it("rejects anonymous API calls with the error envelope", async () => {
    const res = await app.request("/api/apps");
    expect(res.status).toBe(401);
    expect(await res.json() as any).toEqual({ error: { code: "unauthorized", message: "Sign in to continue" } });
  });

  it("gives every new account its own active workspace", async () => {
    const { call } = await signUp(app, "Grace Hopper");
    const res = await call("/api/me");
    expect(res.status).toBe(200);
    const me = await res.json() as any;
    expect(me.user.name).toBe("Grace Hopper");
    expect(me.organization).toMatchObject({ name: "Grace's workspace", role: "owner" });
  });
});

describe("sign-in", () => {
  it("opens later sessions on the user's workspace", async () => {
    const { email } = await signUp(app, "Katherine Johnson");
    const res = await app.request("/api/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN },
      body: JSON.stringify({ email, password: "correct horse battery" }),
    });
    expect(res.status).toBe(200);
    const cookie = res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
    const me = await (await app.request("/api/me", { headers: { cookie } })).json() as any;
    expect(me.organization?.name).toBe("Katherine's workspace");
  });

  it("rejects a wrong password", async () => {
    const { email } = await signUp(app);
    const res = await app.request("/api/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN },
      body: JSON.stringify({ email, password: "wrong password!!" }),
    });
    expect(res.status).toBe(401);
  });
});

describe("apps", () => {
  it("adds an App Store app with server-side details and a public App ID", async () => {
    const { call } = await signUp(app);
    const res = await call("/api/apps", { method: "POST", body: JSON.stringify({ appStoreId: "6700000001" }) });
    expect(res.status).toBe(201);
    const { app: created } = await res.json() as any;
    expect(created).toMatchObject({ name: "LockdList", bundleId: "com.example.lockdlist", appStoreId: "6700000001" });
    expect(created.publicId).toMatch(/^app_[0-9A-Za-z]{22}$/);

    const list = await (await call("/api/apps")).json() as any;
    expect(list.apps.map((a: { id: string }) => a.id)).toEqual([created.id]);

    const dup = await call("/api/apps", { method: "POST", body: JSON.stringify({ appStoreId: "6700000001" }) });
    expect(dup.status).toBe(409);
    expect((await dup.json() as any).error.code).toBe("app_already_added");
  });

  it("adds an app that isn't on the App Store yet by name", async () => {
    const { call } = await signUp(app);
    const res = await call("/api/apps", { method: "POST", body: JSON.stringify({ name: "Secret Project" }) });
    expect(res.status).toBe(201);
    expect((await res.json() as any).app).toMatchObject({ name: "Secret Project", appStoreId: null });
  });

  it("validates input", async () => {
    const { call } = await signUp(app);
    for (const body of [{ name: "x".repeat(101) }, { name: "" }, { appStoreId: "abc" }, { name: "ok", extra: 1 }]) {
      const res = await call("/api/apps", { method: "POST", body: JSON.stringify(body) });
      expect(res.status).toBe(400);
      expect((await res.json() as any).error.code).toBe("validation_failed");
    }
  });

  it("never shows one workspace's apps to another", async () => {
    const alice = await signUp(app, "Alice A");
    const bob = await signUp(app, "Bob B");
    const { app: secret } = await (
      await alice.call("/api/apps", { method: "POST", body: JSON.stringify({ name: "Alice's app" }) })
    ).json() as any;

    for (const path of [`/api/apps/${secret.id}`, `/api/apps/${secret.id}/status`, `/api/apps/${secret.id}/setup-prompt`]) {
      expect((await bob.call(path)).status).toBe(404);
    }
    expect((await bob.call(`/api/apps/${secret.id}`, { method: "PATCH", body: JSON.stringify({ name: "pwned" }) })).status).toBe(404);
    expect((await bob.call(`/api/apps/${secret.id}`, { method: "DELETE" })).status).toBe(404);
    expect((await bob.call(`/api/apps/${secret.id}/identity-secret/reveal`, { method: "POST" })).status).toBe(404);
    expect((await (await bob.call("/api/apps")).json() as any).apps).toEqual([]);
  });

  it("serves the setup prompt with the App ID", async () => {
    const { call } = await signUp(app);
    const { app: created } = await (await call("/api/apps", { method: "POST", body: JSON.stringify({ name: "Prompted" }) })).json() as any;
    const { prompt, lines } = await (await call(`/api/apps/${created.id}/setup-prompt`)).json() as any;
    expect(prompt).toContain(`App ID: ${created.publicId}`);
    expect(prompt).toContain("API: https://api.test");
    expect(lines).toBe(prompt.split("\n").length);
    expect(await (await call(`/api/apps/${created.id}/status`)).json() as any).toEqual({ firstMessageAt: null });
  });

  it("stores the identity secret encrypted and audits every reveal", async () => {
    const { call } = await signUp(app);
    const { app: created } = await (await call("/api/apps", { method: "POST", body: JSON.stringify({ name: "Secretive" }) })).json() as any;
    const [row] = await deps.db.select().from(apps).where(eq(apps.id, created.id));
    expect(row!.identitySecretEnc.startsWith("v1:")).toBe(true);

    const res = await call(`/api/apps/${created.id}/identity-secret/reveal`, { method: "POST" });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const { secret } = await res.json() as any;
    expect(secret).toMatch(/^ids_[0-9A-Za-z]{40}$/);
    expect(row!.identitySecretEnc).not.toContain(secret);

    const audits = await deps.db.select().from(auditEvents).where(eq(auditEvents.target, created.id));
    expect(audits.map((a) => a.action)).toEqual(["app.identity_secret.revealed"]);
  });

  it("soft-deletes apps", async () => {
    const { call } = await signUp(app);
    const { app: created } = await (await call("/api/apps", { method: "POST", body: JSON.stringify({ name: "Doomed" }) })).json() as any;
    expect((await call(`/api/apps/${created.id}`, { method: "DELETE" })).status).toBe(204);
    expect((await call(`/api/apps/${created.id}`)).status).toBe(404);
  });
});

describe("billing", () => {
  it("reports billing as off when Stripe test keys aren't configured", async () => {
    const { call } = await signUp(app);
    expect(await (await call("/api/billing")).json() as any).toEqual({ enabled: false, plan: "founder", subscription: null });
  });
});
