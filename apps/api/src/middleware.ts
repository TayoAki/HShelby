import { apps, devices, members } from "@hshelby/db";
import { and, eq, isNull } from "drizzle-orm";
import { createMiddleware } from "hono/factory";
import type { AppEnv, Deps, SdkEnv } from "./context";
import { verifyAccessToken } from "./device-tokens";
import { ApiError } from "./errors";

type Session = AppEnv["Variables"]["session"];

/** Loads the Better Auth session; 401 without one. */
export const requireSession = (deps: Deps) =>
  createMiddleware<AppEnv>(async (c, next) => {
    const result = await deps.auth.api.getSession({ headers: c.req.raw.headers });
    if (!result) throw new ApiError(401, "unauthorized", "Sign in to continue");
    c.set("user", result.user);
    c.set("session", result.session);
    await next();
  });

/** The session's active organization and the user's role in it, after re-checking membership. */
export async function activeOrganization(deps: Deps, userId: string, session: Session) {
  const organizationId = (session as { activeOrganizationId?: string | null }).activeOrganizationId;
  if (!organizationId) throw new ApiError(403, "no_active_organization", "Choose a workspace first");
  const [membership] = await deps.db
    .select({ role: members.role })
    .from(members)
    .where(and(eq(members.organizationId, organizationId), eq(members.userId, userId)))
    .limit(1);
  if (!membership) throw new ApiError(403, "forbidden", "You're not a member of this workspace");
  return { id: organizationId, role: membership.role };
}

/** Scopes the request to the session's active organization. */
export const requireOrg = (deps: Deps) =>
  createMiddleware<AppEnv>(async (c, next) => {
    c.set("org", await activeOrganization(deps, c.get("user").id, c.get("session")));
    await next();
  });

export const isAdminRole = (role: string) => role === "owner" || role === "admin";

export const requireOrgAdmin = createMiddleware<AppEnv>(async (c, next) => {
  if (!isAdminRole(c.get("org").role)) {
    throw new ApiError(403, "forbidden", "Only workspace owners and admins can do this");
  }
  await next();
});

/**
 * A valid access token for a live device of a live app, with the device's current session version.
 * A 401 tells the SDK to refresh with its device secret (or register again if that fails too).
 */
export async function authenticateDevice(deps: Deps, authorization: string | undefined) {
  const claims = authorization?.startsWith("Bearer ") ? await verifyAccessToken(deps.deviceTokenKey, authorization.slice(7)) : null;
  if (!claims) throw new ApiError(401, "unauthorized", "Access token is missing, invalid or expired");

  const [row] = await deps.db
    .select({
      device: devices,
      app: {
        id: apps.id,
        organizationId: apps.organizationId,
        onlyVerified: apps.onlyVerified,
        identitySecretEnc: apps.identitySecretEnc,
        appStoreId: apps.appStoreId,
      },
    })
    .from(devices)
    .innerJoin(apps, and(eq(apps.id, devices.appId), isNull(apps.deletedAt)))
    .where(and(eq(devices.id, claims.deviceId), isNull(devices.deletedAt), isNull(devices.signedOutAt)))
    .limit(1);
  if (!row || row.device.appId !== claims.appId || row.device.sessionVersion !== claims.sessionVersion) {
    throw new ApiError(401, "unauthorized", "This device session has ended");
  }

  // last-seen at most once a minute, so polling doesn't write on every request
  if (!row.device.lastSeenAt || Date.now() - row.device.lastSeenAt.getTime() > 60_000) {
    await deps.db.update(devices).set({ lastSeenAt: new Date() }).where(eq(devices.id, row.device.id));
  }
  return row;
}

/** SDK routes: see `authenticateDevice`. */
export const requireDevice = (deps: Deps) =>
  createMiddleware<SdkEnv>(async (c, next) => {
    const { device, app } = await authenticateDevice(deps, c.req.header("authorization"));
    c.set("device", device);
    c.set("app", app);
    await next();
  });
