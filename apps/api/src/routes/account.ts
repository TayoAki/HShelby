import { organizations, userPhotos } from "@hshelby/db";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import type { AppEnv, Deps } from "../context";
import { ApiError } from "../errors";

export function accountRoutes(deps: Deps) {
  const r = new Hono<AppEnv>();

  r.get("/me", async (c) => {
    const user = c.get("user");
    const org = c.get("org");
    const [row] = await deps.db.select().from(organizations).where(eq(organizations.id, org.id)).limit(1);
    const [photo] = await deps.db.select().from(userPhotos).where(eq(userPhotos.userId, user.id));
    const photoUrl = photo && deps.storage ? await deps.storage.presignDownload(photo.objectKey, 3600, "image/jpeg") : null;
    return c.json({
      user: { id: user.id, name: user.name, email: user.email, photoUrl },
      organization: row ? { id: row.id, name: row.name, slug: row.slug, role: org.role } : null,
    });
  });

  r.get("/billing", async (c) => {
    const org = c.get("org");
    return c.json(await deps.billing.state(org.id, org.role));
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
