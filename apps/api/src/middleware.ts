import { members } from "@hshelby/db";
import { and, eq } from "drizzle-orm";
import { createMiddleware } from "hono/factory";
import type { AppEnv, Deps } from "./context";
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
