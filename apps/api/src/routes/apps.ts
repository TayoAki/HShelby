import { CreateAppInput, UpdateAppInput, type App as AppDto } from "@hshelby/contracts";
import { buildSetupPrompt, decryptSecret, encryptSecret, newIdentitySecret, newPublicAppId, uuidv7 } from "@hshelby/core";
import { apps, auditEvents } from "@hshelby/db";
import { and, desc, eq, isNull } from "drizzle-orm";
import { Hono } from "hono";
import type { AppEnv, Deps } from "../context";
import { ApiError, isUniqueViolation, notFound } from "../errors";
import { requireOrgAdmin } from "../middleware";
import { isUuid, parseJson } from "../validation";

type AppRow = typeof apps.$inferSelect;

const toDto = (a: AppRow): AppDto => ({
  id: a.id,
  publicId: a.publicId,
  name: a.name,
  iconUrl: a.iconUrl,
  bundleId: a.bundleId,
  appStoreId: a.appStoreId,
  appStoreUrl: a.appStoreUrl,
  sellerName: a.sellerName,
  firstMessageAt: a.firstMessageAt?.toISOString() ?? null,
  createdAt: a.createdAt.toISOString(),
});

export function appRoutes(deps: Deps) {
  const { db } = deps;
  const r = new Hono<AppEnv>();

  /** Every lookup is scoped to the active organization; other orgs' apps are simply "not found". */
  async function findApp(orgId: string, id: string) {
    if (!isUuid(id)) throw notFound("App");
    const [row] = await db
      .select()
      .from(apps)
      .where(and(eq(apps.id, id), eq(apps.organizationId, orgId), isNull(apps.deletedAt)))
      .limit(1);
    if (!row) throw notFound("App");
    return row;
  }

  r.get("/", async (c) => {
    const rows = await db
      .select()
      .from(apps)
      .where(and(eq(apps.organizationId, c.get("org").id), isNull(apps.deletedAt)))
      .orderBy(desc(apps.createdAt));
    return c.json({ apps: rows.map(toDto) });
  });

  r.post("/", async (c) => {
    const input = await parseJson(c, CreateAppInput);
    const org = c.get("org");

    let details: Pick<AppRow, "name" | "iconUrl" | "bundleId" | "appStoreId" | "appStoreUrl" | "sellerName">;
    if ("appStoreId" in input) {
      // Trust Apple, not the client, for name/icon/bundle.
      let found;
      try {
        found = await deps.appStore.lookup(input.appStoreId);
      } catch (err) {
        deps.logger.warn({ err }, "App Store lookup failed");
        throw new ApiError(502, "app_store_unavailable", "The App Store didn't respond. Try again in a moment.");
      }
      if (!found) throw notFound("App Store app");
      details = {
        name: found.name.slice(0, 100),
        iconUrl: found.iconUrl,
        bundleId: found.bundleId,
        appStoreId: found.appStoreId,
        appStoreUrl: found.url,
        sellerName: found.sellerName,
      };
    } else {
      details = { name: input.name, iconUrl: null, bundleId: null, appStoreId: null, appStoreUrl: null, sellerName: null };
    }

    try {
      const [row] = await db
        .insert(apps)
        .values({
          id: uuidv7(),
          organizationId: org.id,
          publicId: newPublicAppId(),
          identitySecretEnc: encryptSecret(newIdentitySecret(), deps.keyring),
          ...details,
        })
        .returning();
      return c.json({ app: toDto(row!) }, 201);
    } catch (err) {
      if (isUniqueViolation(err)) throw new ApiError(409, "app_already_added", "This app is already in your workspace");
      throw err;
    }
  });

  r.get("/:id", async (c) => c.json({ app: toDto(await findApp(c.get("org").id, c.req.param("id"))) }));

  r.patch("/:id", async (c) => {
    const input = await parseJson(c, UpdateAppInput);
    const app = await findApp(c.get("org").id, c.req.param("id"));
    const [row] = await db.update(apps).set({ name: input.name, updatedAt: new Date() }).where(eq(apps.id, app.id)).returning();
    return c.json({ app: toDto(row!) });
  });

  r.delete("/:id", requireOrgAdmin, async (c) => {
    const org = c.get("org");
    const app = await findApp(org.id, c.req.param("id"));
    await db.transaction(async (tx) => {
      await tx.update(apps).set({ deletedAt: new Date() }).where(eq(apps.id, app.id));
      await tx.insert(auditEvents).values({ id: uuidv7(), organizationId: org.id, userId: c.get("user").id, action: "app.deleted", target: app.id });
    });
    return c.body(null, 204);
  });

  r.get("/:id/status", async (c) => {
    const app = await findApp(c.get("org").id, c.req.param("id"));
    return c.json({ firstMessageAt: app.firstMessageAt?.toISOString() ?? null });
  });

  r.get("/:id/setup-prompt", async (c) => {
    const app = await findApp(c.get("org").id, c.req.param("id"));
    const prompt = buildSetupPrompt({
      appName: app.name,
      publicId: app.publicId,
      apiBaseUrl: deps.env.PUBLIC_API_URL ?? new URL(c.req.url).origin,
      docsUrl: deps.env.DOCS_URL,
      swiftPackageUrl: deps.env.SWIFT_PACKAGE_URL,
      reactNativePackage: deps.env.RN_PACKAGE,
    });
    return c.json({ prompt, lines: prompt.split("\n").length });
  });

  /** Reveals the identity-verification secret to owners/admins; every reveal is audited. */
  r.post("/:id/identity-secret/reveal", requireOrgAdmin, async (c) => {
    const org = c.get("org");
    const app = await findApp(org.id, c.req.param("id"));
    await db.insert(auditEvents).values({
      id: uuidv7(),
      organizationId: org.id,
      userId: c.get("user").id,
      action: "app.identity_secret.revealed",
      target: app.id,
    });
    c.header("Cache-Control", "no-store");
    return c.json({ secret: decryptSecret(app.identitySecretEnc, deps.keyring) });
  });

  return r;
}
