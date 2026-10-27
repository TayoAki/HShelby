import { organizations, subscriptions } from "@hshelby/db";
import { desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { BILLING_PLAN } from "../auth";
import type { AppEnv, Deps } from "../context";
import { billingEnabled } from "../env";
import { ApiError } from "../errors";

export function accountRoutes(deps: Deps) {
  const r = new Hono<AppEnv>();

  r.get("/me", async (c) => {
    const user = c.get("user");
    const org = c.get("org");
    const [row] = await deps.db.select().from(organizations).where(eq(organizations.id, org.id)).limit(1);
    return c.json({
      user: { id: user.id, name: user.name, email: user.email },
      organization: row ? { id: row.id, name: row.name, slug: row.slug, role: org.role } : null,
    });
  });

  r.get("/billing", async (c) => {
    const [sub] = await deps.db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.referenceId, c.get("org").id))
      .orderBy(desc(subscriptions.periodEnd))
      .limit(1);
    return c.json({
      enabled: billingEnabled(deps.env),
      plan: BILLING_PLAN,
      subscription: sub
        ? { status: sub.status, periodEnd: sub.periodEnd?.toISOString() ?? null, cancelAtPeriodEnd: Boolean(sub.cancelAtPeriodEnd) }
        : null,
    });
  });

  r.get("/appstore/search", async (c) => {
    const q = (c.req.query("q") ?? "").trim();
    if (q.length < 2) return c.json({ results: [] });
    try {
      return c.json({ results: await deps.appStore.search(q) });
    } catch (err) {
      deps.logger.warn({ err }, "App Store search failed");
      throw new ApiError(502, "app_store_unavailable", "The App Store didn't respond. Try again in a moment.");
    }
  });

  return r;
}
