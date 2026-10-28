import { apps, devices, members } from "@hshelby/db";
import { and, eq, isNull } from "drizzle-orm";
import { createMiddleware } from "hono/factory";
import type { AppEnv, Deps, SdkEnv } from "./context";
import { verifyAccessToken } from "./device-tokens";
import { ApiError } from "./errors";

/** Loads the Better Auth session; 401 without one. */
export const requireSession = (deps: Deps) =>
  createMiddleware<AppEnv>(async (c, next) => {
    const result = await deps.auth.api.getSession({ headers: c.req.raw.headers });
    if (!result) throw new ApiError(401, "unauthorized", "Sign in to continue");
    c.set("user", result.user);
    c.set("session", result.session);
    await next();
  });

/** Scopes the request to the session's active organization, after re-checking membership. */
export const requireOrg = (deps: Deps) =>
  createMiddleware<AppEnv>(async (c, next) => {
    const organizationId = (c.get("session") as { activeOrganizationId?: string | null }).activeOrganizationId;
    if (!organizationId) throw new ApiError(403, "no_active_organization", "Choose a workspace first");
    const [membership] = await deps.db
      .select({ role: members.role })
      .from(members)
      .where(and(eq(members.organizationId, organizationId), eq(members.userId, c.get("user").id)))
      .limit(1);
    if (!membership) throw new ApiError(403, "forbidden", "You're not a member of this workspace");
    c.set("org", { id: organizationId, role: membership.role });
    await next();
  });

export const requireOrgAdmin = createMiddleware<AppEnv>(async (c, next) => {
  if (!["owner", "admin"].includes(c.get("org").role)) {
    throw new ApiError(403, "forbidden", "Only workspace owners and admins can do this");
  }
  await next();
});

/**
 * SDK routes: a valid access token for a live device of a live app, with the device's current session version.
 * A 401 tells the SDK to refresh with its device secret (or register again if that fails too).
 */
export const requireDevice = (deps: Deps) =>
  createMiddleware<SdkEnv>(async (c, next) => {
    const header = c.req.header("authorization");
    const claims = header?.startsWith("Bearer ") ? await verifyAccessToken(deps.deviceTokenKey, header.slice(7)) : null;
    if (!claims) throw new ApiError(401, "unauthorized", "Access token is missing, invalid or expired");

    const [row] = await deps.db
      .select({ device: devices, organizationId: apps.organizationId })
      .from(devices)
      .innerJoin(apps, and(eq(apps.id, devices.appId), isNull(apps.deletedAt)))
      .where(and(eq(devices.id, claims.deviceId), isNull(devices.deletedAt)))
      .limit(1);
    if (!row || row.device.appId !== claims.appId || row.device.sessionVersion !== claims.sessionVersion) {
      throw new ApiError(401, "unauthorized", "This device session has ended");
    }

    // last-seen at most once a minute, so polling doesn't write on every request
    if (!row.device.lastSeenAt || Date.now() - row.device.lastSeenAt.getTime() > 60_000) {
      await deps.db.update(devices).set({ lastSeenAt: new Date() }).where(eq(devices.id, row.device.id));
    }
    c.set("device", row.device);
    c.set("organizationId", row.organizationId);
    await next();
  });
