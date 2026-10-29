import { createHash } from "node:crypto";
import type { Context } from "hono";
import { ApiError } from "./errors";

/*
 * Rate limits (phase B12): fixed windows counted in this process. Each API instance counts its own share, so with
 * N instances a client can get up to N× a limit; that's enough to stop abuse and runaway clients, and moving the
 * counters to Postgres or Redis would only change this file. `RATE_LIMIT_SCALE` multiplies every limit (0 turns
 * them off, as the tests do; a load test raises it).
 */

export type Limit = { name: string; max: number; windowMs: number };

const MINUTE = 60_000;

export const LIMITS = {
  /** Installs registering from one IP address (a NAT can hide many people, so it's generous). */
  registerPerIp: { name: "register-ip", max: 30, windowMs: 10 * MINUTE },
  /** New devices per app, against scripts registering in a loop. */
  registerPerApp: { name: "register-app", max: 600, windowMs: MINUTE },
  /** Token refresh and logout from one IP address. */
  sessionPerIp: { name: "session-ip", max: 120, windowMs: MINUTE },
  /** Any SDK call from one device; polling the badge every few seconds stays far under it. */
  device: { name: "device", max: 300, windowMs: MINUTE },
  sends: { name: "send", max: 30, windowMs: MINUTE },
  uploads: { name: "upload", max: 20, windowMs: MINUTE },
  track: { name: "track", max: 60, windowMs: MINUTE },
  /** The public appearance document and library images, per IP address. */
  publicPerIp: { name: "public-ip", max: 300, windowMs: MINUTE },
  /** Deliveries to one webhook URL (a provider retrying a backlog sends bursts). */
  webhook: { name: "webhook", max: 1200, windowMs: MINUTE },
} satisfies Record<string, Limit>;

export class RateLimited extends ApiError {
  constructor(readonly retryAfterSeconds: number) {
    super(429, "rate_limited", "Too many requests; try again shortly");
  }
}

export type RateLimiter = ReturnType<typeof createRateLimiter>;

export function createRateLimiter(scale = 1) {
  const windows = new Map<string, { count: number; resetAt: number }>();
  let sweptAt = Date.now();
  return {
    /** Counts one request against `limit` for `key`; throws `RateLimited` past it. */
    hit(limit: Limit, key: string, now = Date.now()) {
      if (scale <= 0) return;
      if (now - sweptAt > MINUTE) {
        for (const [id, w] of windows) if (w.resetAt <= now) windows.delete(id);
        sweptAt = now;
      }
      const id = `${limit.name}:${key}`;
      let w = windows.get(id);
      if (!w || w.resetAt <= now) {
        w = { count: 0, resetAt: now + limit.windowMs };
        windows.set(id, w);
      }
      w.count++;
      if (w.count > Math.ceil(limit.max * scale)) throw new RateLimited(Math.max(1, Math.ceil((w.resetAt - now) / 1000)));
    },
  };
}

/**
 * The client's IP address, hashed: Railway's edge puts it in X-Real-IP (the last X-Forwarded-For hop otherwise).
 * Only the hash is kept, and only for the window.
 */
export function ipKey(c: Context) {
  const ip = c.req.header("x-real-ip") ?? c.req.header("x-forwarded-for")?.split(",").at(-1)?.trim() ?? "unknown";
  return createHash("sha256").update(ip).digest("base64url").slice(0, 22);
}
