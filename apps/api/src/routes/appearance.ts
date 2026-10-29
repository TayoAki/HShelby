import {
  appearanceAssetIds,
  ASSET_LIMITS,
  PublishInput,
  SaveDraftInput,
  TeamDisplayInput,
  type AppearanceDocument,
  type AppearanceImage,
  type AppearanceState,
  type Asset,
} from "@hshelby/contracts";
import { uuidv7 } from "@hshelby/core";
import { appAppearance, apps, assets, auditEvents, userPhotos, type Db } from "@hshelby/db";
import { ImageRejected, toAssetPng, toProfilePhoto } from "@hshelby/storage/convert";
import { and, arrayContains, desc, eq, inArray, isNull, or, sql, sum } from "drizzle-orm";
import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import type { AppEnv, Deps } from "../context";
import { ApiError, notFound } from "../errors";
import { requireOrgAdmin } from "../middleware";
import { ipKey, LIMITS } from "../rate-limit";
import { requireStorage } from "../photos";
import { isUuid, parseJson } from "../validation";
import { findOrgApp } from "./apps";

const emptyState = { draft: {}, draftVersion: 0, published: null, publishedVersion: 0, publishedAt: null, reportedLocal: null, reportedAt: null };

/** Same JSON, ignoring key order. */
const sameDocument = (a: unknown, b: unknown) => JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, sortKeys(x)]));
  return v;
}

async function readAppearance(db: Db, appId: string) {
  const [row] = await db.select().from(appAppearance).where(eq(appAppearance.appId, appId));
  return row ?? null;
}

const assetKey = (organizationId: string, id: string) => `orgs/${organizationId}/assets/${id}.png`;

/** The app's Chat design under /api/apps/:id/appearance (admins edit) and the team display switches. */
export function appearanceRoutes(deps: Deps) {
  const { db } = deps;
  const r = new Hono<AppEnv>();

  async function state(app: { id: string; showTeamPhotos: boolean; showTeamNames: boolean }): Promise<AppearanceState> {
    const row = (await readAppearance(db, app.id)) ?? emptyState;
    return {
      draft: row.draft,
      draftVersion: row.draftVersion,
      published: row.published,
      publishedVersion: row.publishedVersion,
      publishedAt: row.publishedAt?.toISOString() ?? null,
      unpublishedChanges: !sameDocument(row.draft, row.published ?? {}),
      reportedLocal: (row.reportedLocal as AppearanceDocument | null) ?? null,
      reportedAt: row.reportedAt?.toISOString() ?? null,
      team: { showPhotos: app.showTeamPhotos, showNames: app.showTeamNames },
    };
  }

  /** A document may only use images from this workspace's library. */
  async function assertOwnAssets(organizationId: string, document: AppearanceDocument) {
    const ids = appearanceAssetIds(document);
    if (ids.length === 0) return ids;
    const found = await db
      .select({ id: assets.id })
      .from(assets)
      .where(and(eq(assets.organizationId, organizationId), inArray(assets.id, ids)));
    if (found.length !== ids.length) throw new ApiError(400, "validation_failed", "The design uses an image that isn't in your asset library");
    return ids;
  }

  const conflict = () =>
    new ApiError(409, "appearance_conflict", "Someone else changed this design since you opened it. Reload to see their changes.");

  r.get("/:id/appearance", async (c) => {
    const app = await findOrgApp(db, c.get("org").id, c.req.param("id"));
    return c.json(await state(app));
  });

  /** Saves the draft if it's still at `baseVersion`; never touches what apps see. */
  r.put("/:id/appearance/draft", requireOrgAdmin, async (c) => {
    const { document, baseVersion } = await parseJson(c, SaveDraftInput);
    const org = c.get("org");
    const app = await findOrgApp(db, org.id, c.req.param("id"));
    const draftAssetIds = await assertOwnAssets(org.id, document);
    const values = { draft: document, draftAssetIds, draftUpdatedAt: new Date(), draftUpdatedBy: c.get("user").id };
    if (baseVersion === 0) {
      const [created] = await db
        .insert(appAppearance)
        .values({ appId: app.id, ...values, draftVersion: 1 })
        .onConflictDoNothing()
        .returning();
      if (!created) {
        // the row exists: only fine if nobody has saved yet
        const [updated] = await db
          .update(appAppearance)
          .set({ ...values, draftVersion: 1 })
          .where(and(eq(appAppearance.appId, app.id), eq(appAppearance.draftVersion, 0)))
          .returning();
        if (!updated) throw conflict();
      }
    } else {
      const [updated] = await db
        .update(appAppearance)
        .set({ ...values, draftVersion: sql`${appAppearance.draftVersion} + 1` })
        .where(and(eq(appAppearance.appId, app.id), eq(appAppearance.draftVersion, baseVersion)))
        .returning();
      if (!updated) throw conflict();
    }
    return c.json(await state(app));
  });

  /** Publishes the draft as of `draftVersion`: apps pick it up the next time their chat opens. */
  r.post("/:id/appearance/publish", requireOrgAdmin, async (c) => {
    const { draftVersion } = await parseJson(c, PublishInput);
    const org = c.get("org");
    const app = await findOrgApp(db, org.id, c.req.param("id"));
    await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(appAppearance)
        .set({
          published: sql`${appAppearance.draft}`,
          publishedAssetIds: sql`${appAppearance.draftAssetIds}`,
          publishedVersion: sql`${appAppearance.publishedVersion} + 1`,
          publishedAt: new Date(),
          publishedBy: c.get("user").id,
        })
        .where(and(eq(appAppearance.appId, app.id), eq(appAppearance.draftVersion, draftVersion)))
        .returning({ version: appAppearance.publishedVersion });
      if (!updated) throw conflict();
      await tx.insert(auditEvents).values({
        id: uuidv7(),
        organizationId: org.id,
        userId: c.get("user").id,
        action: "app.appearance.published",
        target: app.id,
        metadata: { version: updated.version, draftVersion },
      });
    });
    return c.json(await state(app));
  });

  /** Throws the draft away: back to what's published (or nothing). */
  r.post("/:id/appearance/discard", requireOrgAdmin, async (c) => {
    const app = await findOrgApp(db, c.get("org").id, c.req.param("id"));
    await db
      .update(appAppearance)
      .set({
        draft: sql`coalesce(${appAppearance.published}, '{}'::jsonb)`,
        draftAssetIds: sql`${appAppearance.publishedAssetIds}`,
        draftVersion: sql`${appAppearance.draftVersion} + 1`,
        draftUpdatedAt: new Date(),
        draftUpdatedBy: c.get("user").id,
      })
      .where(eq(appAppearance.appId, app.id));
    return c.json(await state(app));
  });

  /** Team photos and names beside replies: apply at once, no publishing. */
  r.patch("/:id/team-display", requireOrgAdmin, async (c) => {
    const input = await parseJson(c, TeamDisplayInput);
    const app = await findOrgApp(db, c.get("org").id, c.req.param("id"));
    const [updated] = await db
      .update(apps)
      .set({ showTeamPhotos: input.showPhotos, showTeamNames: input.showNames, updatedAt: new Date() })
      .where(eq(apps.id, app.id))
      .returning();
    return c.json(await state(updated!));
  });

  return r;
}

/** The workspace's image library under /api/assets. Everyone sees it; admins add and remove images. */
export function assetRoutes(deps: Deps) {
  const { db } = deps;
  const r = new Hono<AppEnv>();

  async function library(organizationId: string) {
    const storage = deps.storage;
    const rows = await db.select().from(assets).where(eq(assets.organizationId, organizationId)).orderBy(desc(assets.createdAt));
    const ids = rows.map((a) => a.id);
    const users = ids.length
      ? await db
          .select({ appId: apps.id, appName: apps.name, draft: appAppearance.draftAssetIds, published: appAppearance.publishedAssetIds })
          .from(appAppearance)
          .innerJoin(apps, and(eq(apps.id, appAppearance.appId), eq(apps.organizationId, organizationId), isNull(apps.deletedAt)))
      : [];
    const list: Asset[] = await Promise.all(
      rows.map(async (a) => ({
        id: a.id,
        name: a.name,
        url: storage ? await storage.presignDownload(a.objectKey, 900, "image/png") : "",
        width: a.width,
        height: a.height,
        bytes: a.bytes,
        usedBy: users.filter((u) => u.draft.includes(a.id) || u.published.includes(a.id)).map(({ appId, appName }) => ({ appId, appName })),
        createdAt: a.createdAt.toISOString(),
      })),
    );
    return { assets: list, usedBytes: rows.reduce((n, a) => n + a.bytes, 0), quotaBytes: ASSET_LIMITS.quotaBytes };
  }

  r.get("/", async (c) => c.json(await library(c.get("org").id)));

  /** Multipart `file` (SVG, PNG, JPEG or WebP up to 2 MB) and optional `name`; stored as a PNG of at most 512 px. */
  r.post("/", requireOrgAdmin, async (c) => {
    const storage = requireStorage(deps.storage);
    const org = c.get("org");
    const form = await c.req.parseBody();
    const file = form.file;
    if (!(file instanceof File)) throw new ApiError(400, "validation_failed", "file: attach an image");
    if (file.size > ASSET_LIMITS.uploadBytes) throw new ApiError(413, "invalid_image", "Images can be up to 2 MB");
    let png;
    try {
      png = await toAssetPng(Buffer.from(await file.arrayBuffer()), ASSET_LIMITS.maxSide);
    } catch (err) {
      if (err instanceof ImageRejected) throw new ApiError(422, "invalid_image", err.message);
      throw err;
    }
    const [used] = await db.select({ bytes: sum(assets.bytes).mapWith(Number) }).from(assets).where(eq(assets.organizationId, org.id));
    if ((used?.bytes ?? 0) + png.body.length > ASSET_LIMITS.quotaBytes) {
      throw new ApiError(422, "asset_quota_exceeded", "Your asset library is full (50 MB). Delete images you no longer use.");
    }
    const id = uuidv7();
    const name = (typeof form.name === "string" && form.name.trim() ? form.name : file.name || "Image").trim().slice(0, 100);
    await storage.put(assetKey(org.id, id), png.body, "image/png");
    await db.insert(assets).values({
      id,
      organizationId: org.id,
      name,
      objectKey: assetKey(org.id, id),
      bytes: png.body.length,
      width: png.width,
      height: png.height,
      createdBy: c.get("user").id,
    });
    const { assets: list } = await library(org.id);
    return c.json({ asset: list.find((a) => a.id === id) }, 201);
  });

  /** Deletes an image no draft or published design uses. */
  r.delete("/:id", requireOrgAdmin, async (c) => {
    const org = c.get("org");
    const id = c.req.param("id");
    if (!isUuid(id)) throw notFound("Asset");
    const [asset] = await db.select().from(assets).where(and(eq(assets.id, id), eq(assets.organizationId, org.id)));
    if (!asset) throw notFound("Asset");
    const [inUse] = await db
      .select({ appId: appAppearance.appId })
      .from(appAppearance)
      .where(or(arrayContains(appAppearance.draftAssetIds, [id]), arrayContains(appAppearance.publishedAssetIds, [id])))
      .limit(1);
    if (inUse) throw new ApiError(409, "asset_in_use", "An app's design uses this image. Remove it there (and publish) first.");
    await deps.storage?.deleteKeys([asset.objectKey]);
    await db.delete(assets).where(eq(assets.id, id));
    return c.body(null, 204);
  });

  return r;
}

/** The signed-in teammate's profile photo under /api/me/photo. */
export function profilePhotoRoutes(deps: Deps) {
  const { db } = deps;
  const r = new Hono<AppEnv>();

  r.put("/photo", async (c) => {
    const storage = requireStorage(deps.storage);
    const user = c.get("user");
    const form = await c.req.parseBody();
    const file = form.file;
    if (!(file instanceof File)) throw new ApiError(400, "validation_failed", "file: attach a photo");
    let photo;
    try {
      photo = await toProfilePhoto(Buffer.from(await file.arrayBuffer()));
    } catch (err) {
      if (err instanceof ImageRejected) throw new ApiError(422, "invalid_image", err.message);
      throw err;
    }
    const key = `users/${user.id}/photo-${uuidv7()}.jpg`;
    await storage.put(key, photo.body, photo.contentType);
    const [previous] = await db.select().from(userPhotos).where(eq(userPhotos.userId, user.id));
    await db
      .insert(userPhotos)
      .values({ userId: user.id, objectKey: key })
      .onConflictDoUpdate({ target: userPhotos.userId, set: { objectKey: key, updatedAt: new Date() } });
    if (previous) await storage.deleteKeys([previous.objectKey]).catch(() => {});
    return c.json({ photoUrl: await storage.presignDownload(key, 3600, "image/jpeg") });
  });

  r.delete("/photo", async (c) => {
    const user = c.get("user");
    const [previous] = await db.delete(userPhotos).where(eq(userPhotos.userId, user.id)).returning();
    if (previous) await deps.storage?.deleteKeys([previous.objectKey]).catch(() => {});
    return c.body(null, 204);
  });

  return r;
}

/* ---------- public, for the SDK ---------- */

/** Asset images in a published document, as URLs the SDK can download (and cache: they never change). */
function withAssetUrls(doc: AppearanceDocument, base: string): Record<string, unknown> {
  const resolve = (image: AppearanceImage | { type: "hidden" } | undefined) =>
    image?.type === "asset" ? { ...image, url: `${base}/v1/assets/${image.assetId}.png` } : image;
  return {
    ...doc,
    ...(doc.welcomeIcon && { welcomeIcon: resolve(doc.welcomeIcon) }),
    ...(doc.closeIcon && { closeIcon: resolve(doc.closeIcon) }),
    ...(doc.cards && {
      cards: {
        ...doc.cards,
        ...(doc.cards.buttonIcon && { buttonIcon: resolve(doc.cards.buttonIcon) }),
        ...(doc.cards.trailingIcon && { trailingIcon: resolve(doc.cards.trailingIcon) }),
      },
    }),
  };
}

/**
 * `GET /v1/apps/:appId/appearance` and `GET /v1/assets/:id.png`: no credentials (an install fetches its design
 * before registering), cacheable, and only ever the published document, never a draft.
 */
export function publicAppearanceRoutes(deps: Deps) {
  const { db } = deps;
  const r = new Hono();

  // only these paths: this router is mounted at the root of /v1, next to the SDK's routes
  const perIp = createMiddleware(async (c, next) => {
    deps.rateLimiter.hit(LIMITS.publicPerIp, ipKey(c));
    await next();
  });
  r.use("/apps/*", perIp);
  r.use("/assets/*", perIp);

  r.get("/apps/:appId/appearance", async (c) => {
    const [row] = await db
      .select({ app: apps, appearance: appAppearance })
      .from(apps)
      .leftJoin(appAppearance, eq(appAppearance.appId, apps.id))
      .where(and(eq(apps.publicId, c.req.param("appId")), isNull(apps.deletedAt)));
    if (!row) throw new ApiError(404, "not_found", "Unknown App ID");
    const version = row.appearance?.publishedVersion ?? 0;
    const team = { showPhotos: row.app.showTeamPhotos, showNames: row.app.showTeamNames };
    const etag = `W/"${version}-${Number(team.showPhotos)}${Number(team.showNames)}"`;
    c.header("Cache-Control", "public, max-age=60");
    c.header("ETag", etag);
    if (c.req.header("if-none-match") === etag) return c.body(null, 304);
    const base = (deps.env.PUBLIC_API_URL ?? new URL(c.req.url).origin).replace(/\/$/, "");
    const published = row.appearance?.published;
    return c.json({ version, appearance: published ? withAssetUrls(published, base) : null, team });
  });

  /** A library image some app has published; images only in drafts aren't served. */
  r.get("/assets/:file", async (c) => {
    const id = c.req.param("file").replace(/\.png$/, "");
    if (!isUuid(id) || !deps.storage) throw notFound("Asset");
    const [published] = await db
      .select({ key: assets.objectKey })
      .from(assets)
      .where(
        and(
          eq(assets.id, id),
          sql`exists (select 1 from ${appAppearance} where ${arrayContains(appAppearance.publishedAssetIds, [id])})`,
        ),
      );
    if (!published) throw notFound("Asset");
    const body = await deps.storage.read(published.key, 4 * 1024 * 1024);
    if (!body) throw notFound("Asset");
    c.header("Content-Type", "image/png");
    c.header("Cache-Control", "public, max-age=31536000, immutable");
    return c.body(new Uint8Array(body));
  });

  return r;
}
