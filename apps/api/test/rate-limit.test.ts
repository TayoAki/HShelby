/* eslint-disable @typescript-eslint/no-explicit-any -- response bodies are asserted on, not typed */
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { createRateLimiter, LIMITS, RateLimited } from "../src/rate-limit";
import { makeTestApp, workspaceWithApp } from "./helpers";

// a tenth of every limit: 3 registrations per address per 10 minutes, 3 sends per device per minute…
const { app, close } = await makeTestApp({}, { RATE_LIMIT_SCALE: "0.1" });
afterAll(close);

const register = (publicId: string, ip: string) =>
  app.request("/v1/devices", {
    method: "POST",
    headers: { "content-type": "application/json", "x-real-ip": ip },
    body: JSON.stringify({ appId: publicId, device: { model: "iPhone16,1" } }),
  });

describe("rate limits", () => {
  it("limit registrations per address, with a Retry-After", async () => {
    // team sign-up goes through the dashboard API, which these limits don't cover
    const team = await workspaceWithApp(app);
    for (let i = 0; i < 3; i++) expect((await register(team.publicId, "203.0.113.7")).status).toBe(201);
    const res = await register(team.publicId, "203.0.113.7");
    expect(res.status).toBe(429);
    expect(((await res.json()) as any).error.code).toBe("rate_limited");
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(500);
    // someone else on another address isn't affected
    expect((await register(team.publicId, "198.51.100.20")).status).toBe(201);
  });

  it("limit each device's sends, not its neighbours'", async () => {
    const team = await workspaceWithApp(app);
    const tokens = await Promise.all(
      ["192.0.2.1", "192.0.2.2"].map(async (ip) => ((await (await register(team.publicId, ip)).json()) as any).accessToken as string),
    );
    const send = (token: string) =>
      app.request("/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ clientId: randomUUID(), text: "hello" }),
      });
    for (let i = 0; i < 3; i++) expect((await send(tokens[0]!)).status).toBe(201);
    expect((await send(tokens[0]!)).status).toBe(429);
    expect((await send(tokens[1]!)).status).toBe(201);
    // reading isn't a send: the device can still poll
    expect((await app.request("/v1/unread", { headers: { authorization: `Bearer ${tokens[0]}` } })).status).toBe(200);
  });

  it("count in fixed windows that reset, and turn off at scale 0", () => {
    const limiter = createRateLimiter(1);
    const limit = { name: "t", max: 2, windowMs: 1000 };
    limiter.hit(limit, "k", 0);
    limiter.hit(limit, "k", 10);
    expect(() => limiter.hit(limit, "k", 20)).toThrow(RateLimited);
    limiter.hit(limit, "other", 20);
    limiter.hit(limit, "k", 1000);
    const off = createRateLimiter(0);
    for (let i = 0; i < 10_000; i++) off.hit(LIMITS.sends, "k");
  });
});
