import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
  PartnerAppInput,
  PartnerExternalId,
  PartnerUsageQuery,
  PartnerWorkspaceInput,
  PartnerWorkspacePatch,
  type PartnerApp,
  type PartnerUsage,
  type PartnerWorkspace,
} from "@hshelby/contracts";
import { base62, encryptSecret, newIdentitySecret, newPublicAppId, tokenCostUsd, uuidv7 } from "@hshelby/core";
import { aiRuns, apps, auditEvents, members, organizations, partnerApps, partnerClaims, partnerWorkspaces, users, type Db, type Tx } from "@hshelby/db";
import { and, asc, count, eq, gt, sql } from "drizzle-orm";
import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import type { Deps } from "../context";
import { ApiError, notFound } from "../errors";
import { hashClaimToken } from "../partners";
import { LIMITS } from "../rate-limit";
import { parseJson, parseQuery } from "../validation";

type PartnerEnv = { Variables: { requestId: string } };
type WorkspaceRow = typeof partnerWorkspaces.$inferSelect;

/** How long a claim link works. */
const CLAIM_DAYS = 7;

const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "workspace";

const digest = (s: string) => createHash("sha256").update(s).digest();

/**
 * The partner API, under /partner/v1: App Builder includes Hire Shelby in the apps it builds (see
 * docs/PARTNER_API.md). One partner per deployment: PARTNER_API_KEY authenticates it, PARTNER_NAME scopes every
 * call to its workspaces. Without a key the routes don't exist (404). Every call is idempotent on the partner's ids.
 */
export function partnerRoutes(deps: Deps) {
  const { db, env } = deps;
  const r = new Hono<PartnerEnv>();
  const partner = env.PARTNER_NAME;
  const dashboardUrl = new URL(env.BETTER_AUTH_URL).origin;
  const expected = env.PARTNER_API_KEY ? digest(env.PARTNER_API_KEY) : null;

  r.use(
    "*",
    createMiddleware<PartnerEnv>(async (c, next) => {
      if (!expected) throw new ApiError(404, "not_found", "Route not found");
      const header = c.req.header("authorization");
      const presented = header?.startsWith("Bearer ") ? header.slice(7).trim() : "";
      // compare digests, so the comparison takes the same time whatever the presented key's length
      if (!presented || !timingSafeEqual(digest(presented), expected)) {
        throw new ApiError(401, "unauthorized", "The partner key is missing or wrong");
      }
      deps.rateLimiter.hit(LIMITS.partner, partner);
      await next();
    }),
  );

  const idOf = (raw: string, field: string) => {
    const parsed = PartnerExternalId.safeParse(raw);
    if (!parsed.success) throw new ApiError(400, "validation_failed", `${field}: ${parsed.error.issues[0]!.message}`);
    return parsed.data;
  };

  const audit = (tx: Db | Tx, organizationId: string, action: string, target: string, metadata: Record<string, unknown>) =>
    tx.insert(auditEvents).values({ id: uuidv7(), organizationId, userId: null, action, target, metadata: { partner, ...metadata } });

  async function findWorkspace(tx: Db | Tx, externalId: string) {
    const [row] = await tx
      .select()
      .from(partnerWorkspaces)
      .where(and(eq(partnerWorkspaces.partner, partner), eq(partnerWorkspaces.externalId, externalId)))
      .limit(1);
    return row ?? null;
  }

  async function requireWorkspace(tx: Db | Tx, externalId: string) {
    const row = await findWorkspace(tx, externalId);
    if (!row) throw notFound("Workspace");
    return row;
  }

  async function toWorkspace(row: WorkspaceRow): Promise<PartnerWorkspace> {
    const [joined] = await db.select({ n: count() }).from(members).where(eq(members.organizationId, row.organizationId));
    return { externalId: row.externalId, active: row.active, aiAllowed: row.aiAllowed, claimed: joined!.n > 0, dashboardUrl };
  }

  /** Creates the workspace (an organization with no members yet), or renames it and updates its owner. */
  r.put("/workspaces/:externalId", async (c) => {
    const externalId = idOf(c.req.param("externalId"), "externalId");
    const input = await parseJson(c, PartnerWorkspaceInput);
    const { row, created } = await db.transaction(async (tx) => {
      const existing = await findWorkspace(tx, externalId);
      if (existing) {
        await tx.update(organizations).set({ name: input.name }).where(eq(organizations.id, existing.organizationId));
        if (existing.ownerEmail === input.ownerEmail) return { row: existing, created: false };
        const [updated] = await tx
          .update(partnerWorkspaces)
          .set({ ownerEmail: input.ownerEmail, updatedAt: new Date() })
          .where(eq(partnerWorkspaces.organizationId, existing.organizationId))
          .returning();
        await audit(tx, existing.organizationId, "partner.workspace.updated", existing.organizationId, { externalId, ownerEmail: input.ownerEmail });
        return { row: updated!, created: false };
      }
      const organizationId = uuidv7();
      await tx.insert(organizations).values({ id: organizationId, name: input.name, slug: `${slugify(input.name)}-${base62(6).toLowerCase()}` });
      const [row] = await tx
        .insert(partnerWorkspaces)
        .values({ organizationId, partner, externalId, ownerEmail: input.ownerEmail })
        .returning();
      await audit(tx, organizationId, "partner.workspace.created", organizationId, { externalId, ownerEmail: input.ownerEmail });
      return { row: row!, created: true };
    });
    return c.json({ workspace: await toWorkspace(row) }, created ? 201 : 200);
  });

  /** The workspace's state: `active` while the owner's plan is paid, `aiAllowed` while they have credits. */
  r.patch("/workspaces/:externalId", async (c) => {
    const externalId = idOf(c.req.param("externalId"), "externalId");
    const input = await parseJson(c, PartnerWorkspacePatch);
    const row = await db.transaction(async (tx) => {
      const existing = await requireWorkspace(tx, externalId);
      const changes = Object.fromEntries(
        Object.entries({ active: input.active, aiAllowed: input.aiAllowed, ownerEmail: input.ownerEmail }).filter(
          ([key, value]) => value !== undefined && value !== existing[key as keyof WorkspaceRow],
        ),
      );
      if (Object.keys(changes).length === 0) return existing;
      const [updated] = await tx
        .update(partnerWorkspaces)
        .set({ ...changes, updatedAt: new Date() })
        .where(eq(partnerWorkspaces.organizationId, existing.organizationId))
        .returning();
      await audit(tx, existing.organizationId, "partner.workspace.updated", existing.organizationId, { externalId, ...changes });
      return updated!;
    });
    return c.json({ workspace: await toWorkspace(row) });
  });

  /**
   * Where the owner answers chats: the dashboard once they've joined with the workspace's owner email, otherwise a
   * new one-time claim link for that email (7 days).
   */
  r.post("/workspaces/:externalId/claim-link", async (c) => {
    const row = await requireWorkspace(db, idOf(c.req.param("externalId"), "externalId"));
    const [owner] = await db
      .select({ id: members.id })
      .from(members)
      .innerJoin(users, eq(users.id, members.userId))
      .where(and(eq(members.organizationId, row.organizationId), eq(sql`lower(${users.email})`, row.ownerEmail)))
      .limit(1);
    if (owner) return c.json({ url: dashboardUrl });
    const token = randomBytes(32).toString("base64url");
    await db.insert(partnerClaims).values({
      tokenHash: hashClaimToken(token),
      organizationId: row.organizationId,
      email: row.ownerEmail,
      expiresAt: new Date(Date.now() + CLAIM_DAYS * 86_400_000),
    });
    return c.json({ url: `${dashboardUrl}/claim/${token}` });
  });

  async function findApp(tx: Db | Tx, appExternalId: string) {
    const [row] = await tx
      .select({ app: apps })
      .from(partnerApps)
      .innerJoin(apps, eq(apps.id, partnerApps.appId))
      .where(and(eq(partnerApps.partner, partner), eq(partnerApps.externalId, appExternalId)))
      .limit(1);
    return row?.app ?? null;
  }

  const toApp = (externalId: string, app: typeof apps.$inferSelect): PartnerApp => ({ externalId, appId: app.publicId, name: app.name });

  /**
   * Creates the app as the dashboard does (public App ID, identity secret; the first message makes the setup
   * conversation), without the dashboard's subscription check: the partner pays. A repeat renames it.
   */
  r.put("/workspaces/:externalId/apps/:appExternalId", async (c) => {
    const externalId = idOf(c.req.param("externalId"), "externalId");
    const appExternalId = idOf(c.req.param("appExternalId"), "appExternalId");
    const input = await parseJson(c, PartnerAppInput);
    const { app, created } = await db.transaction(async (tx) => {
      const workspace = await requireWorkspace(tx, externalId);
      const existing = await findApp(tx, appExternalId);
      if (existing && !existing.deletedAt) {
        if (existing.organizationId !== workspace.organizationId) {
          throw new ApiError(409, "partner_app_conflict", "This project's app belongs to another workspace");
        }
        const [renamed] = await tx
          .update(apps)
          .set({ name: input.name, ...(input.bundleId && { bundleId: input.bundleId }), updatedAt: new Date() })
          .where(eq(apps.id, existing.id))
          .returning();
        return { app: renamed!, created: false };
      }
      // a project whose app was deleted gets a new one
      if (existing) await tx.delete(partnerApps).where(eq(partnerApps.appId, existing.id));
      const [app] = await tx
        .insert(apps)
        .values({
          id: uuidv7(),
          organizationId: workspace.organizationId,
          publicId: newPublicAppId(),
          identitySecretEnc: encryptSecret(newIdentitySecret(), deps.keyring),
          name: input.name,
          bundleId: input.bundleId ?? null,
        })
        .returning();
      await tx.insert(partnerApps).values({ appId: app!.id, partner, externalId: appExternalId });
      await audit(tx, workspace.organizationId, "partner.app.created", app!.id, { externalId: appExternalId, workspaceExternalId: externalId });
      return { app: app!, created: true };
    });
    return c.json({ app: toApp(appExternalId, app) }, created ? 201 : 200);
  });

  /** Deletes the app as the dashboard does (its conversations go with it); deleting it again is fine. */
  r.delete("/workspaces/:externalId/apps/:appExternalId", async (c) => {
    const externalId = idOf(c.req.param("externalId"), "externalId");
    const appExternalId = idOf(c.req.param("appExternalId"), "appExternalId");
    await db.transaction(async (tx) => {
      const workspace = await requireWorkspace(tx, externalId);
      const app = await findApp(tx, appExternalId);
      if (!app || app.deletedAt || app.organizationId !== workspace.organizationId) return;
      await tx.update(apps).set({ deletedAt: new Date() }).where(eq(apps.id, app.id));
      await audit(tx, workspace.organizationId, "app.deleted", app.id, { externalId: appExternalId });
    });
    return c.body(null, 204);
  });

  /**
   * AI runs on the partner's apps that called the model, oldest first after the cursor, with what each cost: App
   * Builder charges its users credits for them. No message content.
   */
  r.get("/usage", async (c) => {
    const { after, limit } = parseQuery(c, PartnerUsageQuery);
    const rows = await db
      .select({
        id: aiRuns.id,
        model: aiRuns.model,
        inputTokens: aiRuns.inputTokens,
        outputTokens: aiRuns.outputTokens,
        cacheReadTokens: aiRuns.cacheReadTokens,
        cacheWriteTokens: aiRuns.cacheWriteTokens,
        createdAt: aiRuns.createdAt,
        appExternalId: partnerApps.externalId,
        workspaceExternalId: partnerWorkspaces.externalId,
      })
      .from(aiRuns)
      .innerJoin(partnerApps, and(eq(partnerApps.appId, aiRuns.appId), eq(partnerApps.partner, partner)))
      .innerJoin(apps, eq(apps.id, aiRuns.appId))
      .innerJoin(partnerWorkspaces, and(eq(partnerWorkspaces.organizationId, apps.organizationId), eq(partnerWorkspaces.partner, partner)))
      .where(
        and(
          after ? gt(aiRuns.id, after) : undefined,
          sql`${aiRuns.inputTokens} + ${aiRuns.outputTokens} + ${aiRuns.cacheReadTokens} + ${aiRuns.cacheWriteTokens} > 0`,
        ),
      )
      .orderBy(asc(aiRuns.id))
      .limit(limit);
    // runs recorded before the model was stored were answered by the configured model
    const fallbackModel = deps.ai?.model ?? null;
    const items = rows.map((r) => ({
      id: r.id,
      workspaceExternalId: r.workspaceExternalId,
      appExternalId: r.appExternalId,
      costUsd: tokenCostUsd(r, r.model ?? fallbackModel),
      createdAt: r.createdAt.toISOString(),
    }));
    return c.json({ items, next: items.at(-1)?.id ?? null } satisfies PartnerUsage);
  });

  return r;
}
