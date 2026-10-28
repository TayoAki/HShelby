import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { requestId } from "hono/request-id";
import { secureHeaders } from "hono/secure-headers";
import type { AppEnv, Deps, SdkEnv } from "./context";
import { ApiError } from "./errors";
import { requireOrg, requireSession } from "./middleware";
import { accountRoutes } from "./routes/account";
import { appRoutes } from "./routes/apps";
import { conversationRoutes, deviceRoutes } from "./routes/inbox";
import { pushRoutes } from "./routes/push";
import { sdkRoutes } from "./routes/sdk";

export function createApp(deps: Deps) {
  const app = new Hono<AppEnv>();

  app.use("*", requestId());
  app.use("*", secureHeaders());
  app.use("*", async (c, next) => {
    const start = performance.now();
    await next();
    if (c.req.path === "/health") return;
    deps.logger.info(
      { requestId: c.get("requestId"), method: c.req.method, path: c.req.path, status: c.res.status, ms: Math.round(performance.now() - start) },
      "request",
    );
  });

  app.get("/health", async (c) => {
    await deps.db.execute(sql`select 1`);
    return c.json({ ok: true });
  });

  // Better Auth owns /api/auth/* (sign-up, sign-in, sessions, organizations, Stripe webhooks).
  app.on(["GET", "POST"], "/api/auth/*", (c) => deps.auth.handler(c.req.raw));

  const limitBody = (kb: number) =>
    bodyLimit({
      maxSize: kb * 1024,
      onError: (c) => c.json({ error: { code: "validation_failed", message: "Body too large" } }, 413),
    });

  // Dashboard API: Better Auth session cookie, scoped to the active organization.
  const api = new Hono<AppEnv>();
  // JSON bodies stay small; a teammate's photo upload may be up to 1 MB plus multipart overhead
  const smallBody = limitBody(64);
  const photoBody = limitBody(1100);
  api.use("*", (c, next) => (/^\/api\/conversations\/[^/]+\/attachments$/.test(c.req.path) ? photoBody : smallBody)(c, next));
  api.use("*", requireSession(deps), requireOrg(deps));
  api.route("/", accountRoutes(deps));
  api.route("/apps", appRoutes(deps));
  api.route("/apps", pushRoutes(deps));
  api.route("/conversations", conversationRoutes(deps));
  api.route("/devices", deviceRoutes(deps));
  app.route("/api", api);

  // SDK API: device access tokens (see routes/sdk.ts).
  const v1 = new Hono<SdkEnv>();
  v1.use("*", limitBody(32));
  v1.route("/", sdkRoutes(deps));
  app.route("/v1", v1);

  app.notFound((c) => c.json({ error: { code: "not_found", message: "Route not found" } }, 404));

  app.onError((err, c) => {
    if (err instanceof ApiError) {
      return c.json({ error: { code: err.code, message: err.message } }, err.status);
    }
    deps.logger.error({ err, requestId: c.get("requestId") }, "unhandled error");
    return c.json({ error: { code: "internal_error", message: "Something went wrong" } }, 500);
  });

  return app;
}
