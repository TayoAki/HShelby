import { PartnerAppInput, PartnerExternalId, PushConfigInput, type PartnerApp } from "@hshelby/contracts";
import { encryptSecret, newIdentitySecret, newPublicAppId, uuidv7 } from "@hshelby/core";
import { apps, auditEvents, betaAccess, invitations, members, organizations, partnerApps, pushConfigs, users, type Db, type Tx } from "@hshelby/db";
import { and, desc, eq, gt, sql } from "drizzle-orm";
import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import type { Deps } from "../context";
import { partnerWelcomeEmail } from "../email";
import { ApiError, notFound } from "../errors";
import { parsePartners, partnerServiceEmail, type Partner } from "../partners";
import { LIMITS } from "../rate-limit";
import { parseJson } from "../validation";
import { savePushConfig } from "./push";

type PartnerEnv = { Variables: { partner: Partner; requestId: string } };

/** How long an owner's invitation stays open; the partner's next PUT renews an expired one. */
const INVITATION_DAYS = 90;
const DAY = 86_400_000;

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "workspace";

/**
 * The partner API, under /partner/v1: a partner (an app builder) creates a Hire Shelby app for each project it
 * builds, for the project's owner, and gets the App ID to build into the app. Authenticated with the partner's key
 * (`Authorization: Bearer …`, configured in PARTNERS). Every call is idempotent by the partner's project ID.
 */
export function partnerRoutes(deps: Deps) {
  const { db, env } = deps;
  const r = new Hono<PartnerEnv>();
  const partnerFor = parsePartners(env.PARTNERS);
  const dashboard = env.BETTER_AUTH_URL.replace(/\/$/, "");
  const apiBaseUrl = (env.PUBLIC_API_URL ?? "https://api.hireshelby.com").replace(/\/$/, "");

  r.use(
    "*",
    createMiddleware<PartnerEnv>(async (c, next) => {
      const header = c.req.header("authorization");
      const partner = partnerFor(header?.startsWith("Bearer ") ? header.slice(7).trim() : undefined);
      if (!partner) throw new ApiError(401, "unauthorized", "A partner key is missing or wrong");
      deps.rateLimiter.hit(LIMITS.partner, partner.id);
      c.set("partner", partner);
      await next();
    }),
  );

  const externalIdOf = (raw: string) => {
    const parsed = PartnerExternalId.safeParse(raw);
    if (!parsed.success) throw new ApiError(400, "validation_failed", `externalId: ${parsed.error.issues[0]!.message}`);
    return parsed.data;
  };

  async function find(partner: Partner, externalId: string) {
    const [row] = await db
      .select({ link: partnerApps, app: apps, workspace: organizations })
      .from(partnerApps)
      .innerJoin(apps, eq(apps.id, partnerApps.appId))
      .innerJoin(organizations, eq(organizations.id, partnerApps.organizationId))
      .where(and(eq(partnerApps.partner, partner.id), eq(partnerApps.externalId, externalId), sql`${apps.deletedAt} is null`))
      .limit(1);
    return row ?? null;
  }

  /** The partner's service account, which invites owners (made on first use; it has no password, so no sign-in). */
  async function serviceUser(tx: Db | Tx, partner: Partner) {
    const email = partnerServiceEmail(partner);
    await tx
      .insert(users)
      .values({ id: uuidv7(), name: partner.name, email, emailVerified: false })
      .onConflictDoNothing({ target: users.email });
    const [user] = await tx.select({ id: users.id }).from(users).where(eq(users.email, email));
    return user!;
  }

  /**
   * Makes sure the owner can get in: a member already if they have an account, otherwise a pending invitation
   * (renewed when expired). Returns whether anything new happened, for the welcome email.
   */
  async function ensureOwner(tx: Db | Tx, partner: Partner, organizationId: string, email: string) {
    const [user] = await tx.select({ id: users.id }).from(users).where(eq(sql`lower(${users.email})`, email)).limit(1);
    if (user) {
      const added = await tx
        .insert(members)
        .values({ id: uuidv7(), organizationId, userId: user.id, role: "owner" })
        .onConflictDoNothing({ target: [members.organizationId, members.userId] })
        .returning({ id: members.id });
      return { changed: added.length > 0, hasAccount: true };
    }
    const [pending] = await tx
      .select({ id: invitations.id })
      .from(invitations)
      .where(
        and(
          eq(invitations.organizationId, organizationId),
          eq(sql`lower(${invitations.email})`, email),
          eq(invitations.status, "pending"),
          gt(invitations.expiresAt, new Date()),
        ),
      )
      .limit(1);
    if (pending) return { changed: false, hasAccount: false };
    const inviter = await serviceUser(tx, partner);
    await tx.insert(invitations).values({
      id: uuidv7(),
      organizationId,
      email,
      role: "owner",
      status: "pending",
      expiresAt: new Date(Date.now() + INVITATION_DAYS * DAY),
      inviterId: inviter.id,
    });
    return { changed: true, hasAccount: false };
  }

  async function describe(row: NonNullable<Awaited<ReturnType<typeof find>>>): Promise<PartnerApp> {
    const { link, app, workspace } = row;
    const email = link.ownerEmail;
    const [member] = await db
      .select({ id: members.id })
      .from(members)
      .innerJoin(users, eq(users.id, members.userId))
      .where(and(eq(members.organizationId, workspace.id), eq(sql`lower(${users.email})`, email)))
      .limit(1);
    const [invitation] = member
      ? []
      : await db
          .select({ expiresAt: invitations.expiresAt })
          .from(invitations)
          .where(and(eq(invitations.organizationId, workspace.id), eq(sql`lower(${invitations.email})`, email), eq(invitations.status, "pending")))
          .orderBy(desc(invitations.expiresAt))
          .limit(1);
    const status = member ? "member" : invitation && invitation.expiresAt > new Date() ? "invited" : "expired";
    const [push] = await db.select().from(pushConfigs).where(eq(pushConfigs.appId, app.id));
    return {
      externalId: link.externalId,
      app: { id: app.id, appId: app.publicId, name: app.name, bundleId: app.bundleId },
      workspace: { id: workspace.id, name: workspace.name },
      owner: { email, status, invitationExpiresAt: status === "member" ? null : (invitation?.expiresAt.toISOString() ?? null) },
      urls: {
        inbox: `${dashboard}/inbox`,
        signUp: status === "member" ? null : `${dashboard}/sign-up?email=${encodeURIComponent(email)}&next=%2Finbox`,
        signIn: `${dashboard}/sign-in?next=%2Finbox`,
      },
      apiBaseUrl,
      push: { configured: Boolean(push), bundleId: push?.bundleId ?? null, issue: push?.issue ?? null },
      createdAt: link.createdAt.toISOString(),
    };
  }

  /** Creates the app (and, for an owner's first, their workspace with beta access), or returns the existing one. */
  r.put("/apps/:externalId", async (c) => {
    const partner = c.get("partner");
    const externalId = externalIdOf(c.req.param("externalId"));
    const input = await parseJson(c, PartnerAppInput);
    const email = input.owner.email;

    const existing = await find(partner, externalId);
    if (existing) {
      if (existing.link.ownerEmail !== email) {
        throw new ApiError(409, "owner_mismatch", "This project's app belongs to another owner; delete it first to move it");
      }
      // renews an expired invitation; the app itself stays as created (the owner may have renamed it)
      const owner = await db.transaction((tx) => ensureOwner(tx, partner, existing.workspace.id, email));
      if (owner.changed) await welcome(partner, email, existing.app.name, owner.hasAccount);
      return c.json(await describe((await find(partner, externalId))!), 200);
    }

    const created = await db.transaction(async (tx) => {
      // one workspace per owner and partner: the owner's earlier projects decide it
      const [earlier] = await tx
        .select({ organizationId: partnerApps.organizationId })
        .from(partnerApps)
        .where(and(eq(partnerApps.partner, partner.id), eq(partnerApps.ownerEmail, email)))
        .orderBy(desc(partnerApps.createdAt))
        .limit(1);
      let organizationId = earlier?.organizationId;
      if (!organizationId) {
        organizationId = uuidv7();
        const first = (input.owner.name ?? email.split("@")[0]!).split(" ")[0]!;
        const name = `${first}'s ${partner.name} apps`;
        await tx.insert(organizations).values({ id: organizationId, name, slug: `${slug(name)}-${uuidv7().slice(-8)}` });
        // the closed beta: a partner's workspace counts as subscribed for PARTNER_BETA_DAYS
        await tx
          .insert(betaAccess)
          .values({ organizationId, until: new Date(Date.now() + env.PARTNER_BETA_DAYS * DAY), note: `partner:${partner.id}` })
          .onConflictDoNothing();
      }
      const [app] = await tx
        .insert(apps)
        .values({
          id: uuidv7(),
          organizationId,
          publicId: newPublicAppId(),
          identitySecretEnc: encryptSecret(newIdentitySecret(), deps.keyring),
          name: input.name,
          bundleId: input.bundleId ?? null,
        })
        .returning();
      // a project whose app was deleted gets the new one (its link stays, so the owner's workspace is remembered)
      const link = { appId: app!.id, organizationId, ownerEmail: email, createdAt: new Date() };
      await tx
        .insert(partnerApps)
        .values({ partner: partner.id, externalId, ...link })
        .onConflictDoUpdate({ target: [partnerApps.partner, partnerApps.externalId], set: link });
      await tx.insert(auditEvents).values({
        id: uuidv7(),
        organizationId,
        userId: null,
        action: "partner.app_created",
        target: app!.id,
        metadata: { partner: partner.id, externalId, owner: email },
      });
      const owner = await ensureOwner(tx, partner, organizationId, email);
      return { app: app!, owner };
    });
    if (created.owner.changed) await welcome(partner, email, created.app.name, created.owner.hasAccount);
    return c.json(await describe((await find(partner, externalId))!), 201);
  });

  r.get("/apps/:externalId", async (c) => {
    const row = await find(c.get("partner"), externalIdOf(c.req.param("externalId")));
    if (!row) throw notFound("App");
    return c.json(await describe(row));
  });

  /**
   * Deletes the app (its conversations go with it, as from the dashboard). The project ID can be used again, and
   * the owner's workspace stays theirs for their next app.
   */
  r.delete("/apps/:externalId", async (c) => {
    const partner = c.get("partner");
    const row = await find(partner, externalIdOf(c.req.param("externalId")));
    if (!row) throw notFound("App");
    await db.transaction(async (tx) => {
      await tx.update(apps).set({ deletedAt: new Date() }).where(eq(apps.id, row.app.id));
      await tx.insert(auditEvents).values({
        id: uuidv7(),
        organizationId: row.workspace.id,
        userId: null,
        action: "app.deleted",
        target: row.app.id,
        metadata: { partner: partner.id, externalId: row.link.externalId },
      });
    });
    return c.body(null, 204);
  });

  /** The app's APNs key and notification settings, as in the dashboard's Push settings (the key never comes back). */
  r.put("/apps/:externalId/push", async (c) => {
    const partner = c.get("partner");
    const row = await find(partner, externalIdOf(c.req.param("externalId")));
    if (!row) throw notFound("App");
    const input = await parseJson(c, PushConfigInput);
    await savePushConfig(deps, { appId: row.app.id, organizationId: row.workspace.id, userId: null, partner: partner.id }, input);
    return c.json(await describe(row));
  });

  /** Tells the owner where to answer their users; a failed email never fails the call (the partner has the links). */
  async function welcome(partner: Partner, email: string, appName: string, hasAccount: boolean) {
    const url = hasAccount ? `${dashboard}/sign-in?next=%2Finbox` : `${dashboard}/sign-up?email=${encodeURIComponent(email)}&next=%2Finbox`;
    try {
      await deps.mailer.send(partnerWelcomeEmail(email, partner.name, appName, url, hasAccount));
    } catch (err) {
      deps.logger.warn({ err, partner: partner.id }, "partner welcome email not sent");
    }
  }

  return r;
}
