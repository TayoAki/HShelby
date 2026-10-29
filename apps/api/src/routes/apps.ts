import {
  CardSettingsInput,
  CardStatsQuery,
  CreateAppInput,
  RotateIdentitySecretInput,
  UpdateAppInput,
  type App as AppDto,
  type AppPaywall,
} from "@hshelby/contracts";
import { buildSetupPrompt, decryptSecret, encryptSecret, newIdentitySecret, newPublicAppId, uuidv7 } from "@hshelby/core";
import { appPaywalls, apps, auditEvents, cardSettings, devices, type Db } from "@hshelby/db";
import { and, desc, eq, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { cardStats, getCardSettings } from "../cards";
import type { AppEnv, Deps } from "../context";
import { ApiError, isUniqueViolation, notFound } from "../errors";
import { isAdminRole, requireOrgAdmin } from "../middleware";
import { isUuid, parseJson, parseQuery } from "../validation";

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
  onlyVerified: a.onlyVerified,
  identitySecretRotatedAt: a.identitySecretRotatedAt?.toISOString() ?? null,
  createdAt: a.createdAt.toISOString(),
});

/** Every lookup is scoped to the active organization; other orgs' apps are simply "not found". */
export async function findOrgApp(db: Db, orgId: string, id: string) {
  if (!isUuid(id)) throw notFound("App");
  const [row] = await db
    .select()
    .from(apps)
    .where(and(eq(apps.id, id), eq(apps.organizationId, orgId), isNull(apps.deletedAt)))
    .limit(1);
  if (!row) throw notFound("App");
  return row;
}

export function appRoutes(deps: Deps) {
  const { db } = deps;
  const r = new Hono<AppEnv>();

  const findApp = (orgId: string, id: string) => findOrgApp(db, orgId, id);

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
    await deps.billing.requireCanAddApp(org.id);

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
    const org = c.get("org");
    if ((input.onlyVerified !== undefined || input.appStoreId !== undefined) && !isAdminRole(org.role)) {
      throw new ApiError(403, "forbidden", "Only workspace owners and admins can change these settings");
    }
    const app = await findApp(org.id, c.req.param("id"));
    const row = await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(apps)
        .set({ name: input.name, onlyVerified: input.onlyVerified, appStoreId: input.appStoreId, updatedAt: new Date() })
        .where(eq(apps.id, app.id))
        .returning()
        .catch((err: unknown) => {
          if (isUniqueViolation(err, "apps_org_app_store_uq")) {
            throw new ApiError(409, "app_already_added", "Another app in this workspace has that App Store ID");
          }
          throw err;
        });
      if (input.onlyVerified !== undefined && input.onlyVerified !== app.onlyVerified) {
        await tx.insert(auditEvents).values({
          id: uuidv7(),
          organizationId: org.id,
          userId: c.get("user").id,
          action: input.onlyVerified ? "app.only_verified.enabled" : "app.only_verified.disabled",
          target: app.id,
        });
      }
      if (input.appStoreId !== undefined && input.appStoreId !== app.appStoreId) {
        await tx.insert(auditEvents).values({
          id: uuidv7(),
          organizationId: org.id,
          userId: c.get("user").id,
          action: "app.app_store_id.changed",
          target: app.id,
          metadata: { from: app.appStoreId, to: input.appStoreId },
        });
      }
      return updated!;
    });
    return c.json({ app: toDto(row) });
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

  /** Review templates and button labels (phase B7). Everyone can read them; admins change them. */
  r.get("/:id/cards/settings", async (c) => {
    const app = await findApp(c.get("org").id, c.req.param("id"));
    return c.json(await getCardSettings(db, app));
  });

  r.put("/:id/cards/settings", requireOrgAdmin, async (c) => {
    const input = await parseJson(c, CardSettingsInput);
    const app = await findApp(c.get("org").id, c.req.param("id"));
    const current = await getCardSettings(db, app);
    const next = {
      reviewTemplates: input.reviewTemplates ?? current.reviewTemplates,
      reviewButtonLabels: input.reviewButtonLabels ?? current.reviewButtonLabels,
      offerButtonLabels: input.offerButtonLabels ?? current.offerButtonLabels,
    };
    await db
      .insert(cardSettings)
      .values({ appId: app.id, ...next })
      .onConflictDoUpdate({ target: cardSettings.appId, set: { ...next, updatedAt: new Date() } });
    return c.json(await getCardSettings(db, app));
  });

  /** Every paywall the app's devices have reported, most recently reported first. */
  r.get("/:id/paywalls", async (c) => {
    const app = await findApp(c.get("org").id, c.req.param("id"));
    const rows = await db.select().from(appPaywalls).where(eq(appPaywalls.appId, app.id)).orderBy(desc(appPaywalls.lastReportedAt));
    const paywalls: AppPaywall[] = rows.map((p) => ({
      id: p.paywallId,
      title: p.title,
      source: p.source,
      presentable: p.presentable,
      products: p.products,
      firstReportedAt: p.firstReportedAt.toISOString(),
      lastReportedAt: p.lastReportedAt.toISOString(),
    }));
    return c.json({ paywalls });
  });

  /** Cards sent and first opens over 7, 30 or 90 days. */
  r.get("/:id/cards/stats", async (c) => {
    const { days } = parseQuery(c, CardStatsQuery);
    const app = await findApp(c.get("org").id, c.req.param("id"));
    return c.json(await cardStats(db, app.id, days));
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

  /**
   * Replaces the identity secret: tokens signed with the old one stop verifying at once. With
   * `unverifyExisting` (for a leaked secret), every device of the app drops back to unverified.
   */
  r.post("/:id/identity-secret/rotate", requireOrgAdmin, async (c) => {
    const { unverifyExisting } = await parseJson(c, RotateIdentitySecretInput);
    const org = c.get("org");
    const app = await findApp(org.id, c.req.param("id"));
    const secret = newIdentitySecret();
    await db.transaction(async (tx) => {
      await tx
        .update(apps)
        .set({ identitySecretEnc: encryptSecret(secret, deps.keyring), identitySecretRotatedAt: new Date(), updatedAt: new Date() })
        .where(eq(apps.id, app.id));
      const unverified = unverifyExisting
        ? await tx
            .update(devices)
            .set({ verified: false, updatedAt: new Date() })
            .where(and(eq(devices.appId, app.id), eq(devices.verified, true)))
            .returning({ id: devices.id })
        : [];
      await tx.insert(auditEvents).values({
        id: uuidv7(),
        organizationId: org.id,
        userId: c.get("user").id,
        action: "app.identity_secret.rotated",
        target: app.id,
        metadata: { unverifyExisting, unverifiedDevices: unverified.length },
      });
    });
    c.header("Cache-Control", "no-store");
    return c.json({ secret });
  });

  return r;
}
