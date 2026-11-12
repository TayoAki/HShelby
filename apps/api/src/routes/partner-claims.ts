import { type PartnerClaimInfo } from "@hshelby/contracts";
import { uuidv7 } from "@hshelby/core";
import { auditEvents, members, organizations, partnerClaims, partnerWorkspaces, sessions } from "@hshelby/db";
import { and, eq, isNull } from "drizzle-orm";
import { Hono } from "hono";
import type { AppEnv, Deps } from "../context";
import { ApiError, notFound } from "../errors";
import { requireSession } from "../middleware";
import { hashClaimToken, partnerDisplayName } from "../partners";

const TOKEN = /^[A-Za-z0-9_-]{20,100}$/;

/**
 * A partner's one-time claim link (POST /partner/v1/workspaces/:id/claim-link), under /api/partner-claims: the
 * dashboard's /claim/[token] page reads it signed out, then accepts it once the owner has signed in or up with
 * the address it was made for. Mounted before the organization-scoped /api routes: a new owner has no workspace yet.
 */
export function partnerClaimRoutes(deps: Deps) {
  const { db } = deps;
  const r = new Hono<AppEnv>();

  async function find(token: string) {
    if (!TOKEN.test(token)) throw notFound("Claim link");
    const [row] = await db
      .select({ claim: partnerClaims, workspaceName: organizations.name, partner: partnerWorkspaces.partner })
      .from(partnerClaims)
      .innerJoin(organizations, eq(organizations.id, partnerClaims.organizationId))
      .leftJoin(partnerWorkspaces, eq(partnerWorkspaces.organizationId, partnerClaims.organizationId))
      .where(eq(partnerClaims.tokenHash, hashClaimToken(token)))
      .limit(1);
    if (!row) throw notFound("Claim link");
    return row;
  }

  const statusOf = (claim: typeof partnerClaims.$inferSelect) =>
    claim.usedAt ? "used" : claim.expiresAt <= new Date() ? "expired" : "valid";

  /** Public: the token is the secret. Says which address to sign in with, and whether the link still works. */
  r.get("/:token", async (c) => {
    const { claim, workspaceName, partner } = await find(c.req.param("token"));
    c.header("Cache-Control", "no-store");
    return c.json({
      email: claim.email,
      workspaceName,
      partnerName: partnerDisplayName(partner ?? deps.env.PARTNER_NAME),
      status: statusOf(claim),
    } satisfies PartnerClaimInfo);
  });

  /** Joins the workspace as its owner and opens the session on it; the link then stops working. */
  r.post("/:token/accept", requireSession(deps), async (c) => {
    const { claim } = await find(c.req.param("token"));
    const user = c.get("user");
    const status = statusOf(claim);
    if (status !== "valid") throw new ApiError(403, "forbidden", status === "used" ? "This link was already used" : "This link has expired");
    if (user.email.toLowerCase() !== claim.email) {
      throw new ApiError(403, "forbidden", `This link is for ${claim.email}; sign in with that address`);
    }
    await db.transaction(async (tx) => {
      // only one acceptance wins if the link is opened twice at once
      const [used] = await tx
        .update(partnerClaims)
        .set({ usedAt: new Date() })
        .where(and(eq(partnerClaims.tokenHash, claim.tokenHash), isNull(partnerClaims.usedAt)))
        .returning();
      if (!used) throw new ApiError(403, "forbidden", "This link was already used");
      // the partner may have named another owner since the link was made (read here, so a change can't slip in between)
      const [workspace] = await tx
        .select({ ownerEmail: partnerWorkspaces.ownerEmail })
        .from(partnerWorkspaces)
        .where(eq(partnerWorkspaces.organizationId, claim.organizationId))
        .for("update");
      if (!workspace || workspace.ownerEmail !== claim.email) throw new ApiError(403, "forbidden", "This link no longer works");
      // the owner is in: their other unused links stop working too
      await tx.delete(partnerClaims).where(and(eq(partnerClaims.organizationId, claim.organizationId), isNull(partnerClaims.usedAt)));
      const added = await tx
        .insert(members)
        .values({ id: uuidv7(), organizationId: claim.organizationId, userId: user.id, role: "owner" })
        .onConflictDoNothing({ target: [members.organizationId, members.userId] })
        .returning({ id: members.id });
      if (added.length > 0) {
        await tx.insert(auditEvents).values({
          id: uuidv7(),
          organizationId: claim.organizationId,
          userId: user.id,
          action: "member.added",
          target: user.id,
          metadata: { name: user.name, email: user.email, role: "owner", via: "partner_claim" },
        });
      }
      await tx.update(sessions).set({ activeOrganizationId: claim.organizationId }).where(eq(sessions.id, c.get("session").id));
    });
    return c.json({ organizationId: claim.organizationId });
  });

  return r;
}
