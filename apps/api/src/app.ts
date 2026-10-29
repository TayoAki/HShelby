import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { requestId } from "hono/request-id";
import { secureHeaders } from "hono/secure-headers";
import type { AppEnv, Deps, SdkEnv } from "./context";
import { ApiError } from "./errors";
import { requireOrg, requireSession } from "./middleware";
import { LIMITS, RateLimited } from "./rate-limit";
import { accountRoutes } from "./routes/account";
import { aiRoutes } from "./routes/ai";
import { auditRoutes } from "./routes/audit";
import { appearanceRoutes, assetRoutes, profilePhotoRoutes, publicAppearanceRoutes } from "./routes/appearance";
import { appRoutes } from "./routes/apps";
import { automationRoutes } from "./routes/automations";
import { integrationRoutes, providerWebhookRoutes } from "./routes/integrations";
import { conversationRoutes, deviceRoutes } from "./routes/inbox";
import { pushRoutes } from "./routes/push";
import { sdkRoutes } from "./routes/sdk";
import { telegramSettingsRoutes, telegramWebhookRoutes } from "./routes/telegram";

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

  // What a new subscriber pays and how many founder spots are left, for the landing page.
  app.get("/public/pricing", async (c) => {
    c.header("access-control-allow-origin", "*");
    c.header("cache-control", "public, max-age=60");
    return c.json({ enabled: deps.billing.enabled, offer: await deps.billing.offer() });
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
  // JSON bodies stay small; uploads get room for the file plus multipart overhead, AI settings for the app's docs
  const uploads: [RegExp, ReturnType<typeof limitBody>][] = [
    [/^\/api\/conversations\/[^/]+\/attachments$/, limitBody(1100)],
    [/^\/api\/apps\/[^/]+\/ai(\/preview)?$/, limitBody(1000)],
    [/^\/api\/assets$/, limitBody(2100)],
    [/^\/api\/me\/photo$/, limitBody(5200)],
  ];
  const smallBody = limitBody(64);
  api.use("*", (c, next) => (uploads.find(([path]) => path.test(c.req.path))?.[1] ?? smallBody)(c, next));
  api.use("*", requireSession(deps), requireOrg(deps));
  api.route("/", accountRoutes(deps));
  api.route("/", auditRoutes(deps));
  api.route("/apps", appRoutes(deps));
  api.route("/apps", pushRoutes(deps));
  api.route("/apps", telegramSettingsRoutes(deps));
  api.route("/apps", appearanceRoutes(deps));
  api.route("/apps", integrationRoutes(deps));
  api.route("/apps", automationRoutes(deps));
  api.route("/apps", aiRoutes(deps));
  api.route("/assets", assetRoutes(deps));
  api.route("/me", profilePhotoRoutes(deps));
  api.route("/conversations", conversationRoutes(deps));
  api.route("/devices", deviceRoutes(deps));
  app.route("/api", api);

  // Webhooks from third parties, each authenticated its own way.
  const webhooks = new Hono();
  webhooks.use("*", limitBody(256), async (c, next) => {
    deps.rateLimiter.hit(LIMITS.webhook, c.req.path);
    await next();
  });
  webhooks.route("/telegram", telegramWebhookRoutes(deps));
  webhooks.route("/", providerWebhookRoutes(deps, { roots: deps.appStoreRoots }));
  app.route("/webhooks", webhooks);

  // SDK API: device access tokens (see routes/sdk.ts).
  const v1 = new Hono<SdkEnv>();
  v1.use("*", limitBody(32));
  v1.route("/", publicAppearanceRoutes(deps));
  v1.route("/", sdkRoutes(deps));
  app.route("/v1", v1);

  app.notFound((c) => c.json({ error: { code: "not_found", message: "Route not found" } }, 404));

  app.onError((err, c) => {
    if (err instanceof ApiError) {
      if (err instanceof RateLimited) c.header("Retry-After", String(err.retryAfterSeconds));
      return c.json({ error: { code: err.code, message: err.message } }, err.status);
    }
    deps.logger.error({ err, requestId: c.get("requestId") }, "unhandled error");
    return c.json({ error: { code: "internal_error", message: "Something went wrong" } }, 500);
  });

  return app;
}
