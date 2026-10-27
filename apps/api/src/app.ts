import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { requestId } from "hono/request-id";
import { secureHeaders } from "hono/secure-headers";
import type { AppEnv, Deps } from "./context";
import { ApiError } from "./errors";
import { requireOrg, requireSession } from "./middleware";
import { accountRoutes } from "./routes/account";
import { appRoutes } from "./routes/apps";

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

  const api = new Hono<AppEnv>();
  api.use(
    "*",
    bodyLimit({ maxSize: 64 * 1024, onError: (c) => c.json({ error: { code: "validation_failed", message: "Body too large" } }, 413) }),
  );
  api.use("*", requireSession(deps), requireOrg(deps));
  api.route("/", accountRoutes(deps));
  api.route("/apps", appRoutes(deps));
  app.route("/api", api);

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
