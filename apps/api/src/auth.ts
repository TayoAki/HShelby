import { stripe } from "@better-auth/stripe";
import { brand } from "@hshelby/contracts";
import { base62, uuidv7 } from "@hshelby/core";
import {
  accounts,
  auditEvents,
  betaAccess,
  betaInvites,
  invitations,
  members,
  organizations,
  partnerClaims,
  partnerWorkspaces,
  sessions,
  subscriptions,
  users,
  verifications,
  type Db,
} from "@hshelby/db";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { organization } from "better-auth/plugins/organization";
import { and, asc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import type { Logger } from "pino";
import type Stripe from "stripe";
import type { Billing } from "./billing";
import { invitationEmail, resetPasswordEmail, type Mailer } from "./email";
import type { Env } from "./env";

const slugify = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "workspace";

export async function isOrgAdmin(db: Db, userId: string, organizationId: string) {
  const [row] = await db
    .select({ role: members.role })
    .from(members)
    .where(and(eq(members.userId, userId), eq(members.organizationId, organizationId), inArray(members.role, ["owner", "admin"])))
    .limit(1);
  return Boolean(row);
}

type AuthDeps = { db: Db; env: Env; logger: Logger; stripe: Stripe | null; billing: Billing; mailer: Mailer };

export function createAuth({ db, env, logger, stripe: stripeClient, billing, mailer }: AuthDeps) {
  /**
   * An unused, unexpired partner claim link for this address (App Builder's owner joining their workspace). A link
   * made for an address that is no longer the workspace's owner doesn't count.
   */
  async function hasPartnerClaim(email: string) {
    const [claim] = await db
      .select({ tokenHash: partnerClaims.tokenHash })
      .from(partnerClaims)
      .innerJoin(
        partnerWorkspaces,
        and(eq(partnerWorkspaces.organizationId, partnerClaims.organizationId), eq(partnerWorkspaces.ownerEmail, partnerClaims.email)),
      )
      .where(and(eq(partnerClaims.email, email.toLowerCase()), isNull(partnerClaims.usedAt), gt(partnerClaims.expiresAt, new Date())))
      .limit(1);
    return Boolean(claim);
  }

  const dashboardUrl = env.BETTER_AUTH_URL.replace(/\/$/, "");
  const trustedOrigins = [env.BETTER_AUTH_URL, ...(env.TRUSTED_ORIGINS?.split(",").map((s) => s.trim()) ?? [])];
  const audit = (organizationId: string, userId: string | null, action: string, target: string, metadata: Record<string, unknown>) =>
    db.insert(auditEvents).values({ id: uuidv7(), organizationId, userId, action, target, metadata });

  const plugins = [
    organization({
      // deleting a workspace means its photos, Stripe subscription and Telegram webhooks too, which Better Auth's
      // endpoint doesn't do; closing a workspace is a support request until there's a full deletion job
      disableOrganizationDeletion: true,
      // the link opens the dashboard's accept page; joining needs signing in as the invited address
      async sendInvitationEmail(data) {
        const url = `${dashboardUrl}/accept-invitation/${encodeURIComponent(data.id)}`;
        await mailer.send(invitationEmail(data.email, data.inviter.user.name, data.organization.name, url));
      },
      organizationHooks: {
        // inviting teammates is a paid feature
        async beforeCreateInvitation({ organization }) {
          if (!(await billing.isActive(organization.id))) {
            throw new APIError("PAYMENT_REQUIRED", { code: "subscription_inactive", message: "Subscribe to invite teammates." });
          }
        },
        // the team's own changes go in the audit log (Better Auth doesn't say who removed someone or changed a role)
        async afterCreateInvitation({ invitation, inviter, organization }) {
          await audit(organization.id, inviter.id, "invitation.created", invitation.id, { email: invitation.email, role: invitation.role });
        },
        async afterAddMember({ member, user, organization }) {
          await audit(organization.id, user.id, "member.added", member.userId, { name: user.name, email: user.email, role: member.role });
        },
        async afterRemoveMember({ member, user, organization }) {
          await audit(organization.id, null, "member.removed", member.userId, { name: user.name, email: user.email });
        },
        async afterCancelInvitation({ invitation, cancelledBy, organization }) {
          await audit(organization.id, cancelledBy.id, "invitation.canceled", invitation.id, { email: invitation.email, role: invitation.role });
        },
        async afterUpdateMemberRole({ member, previousRole, user, organization }) {
          await audit(organization.id, null, "member.role_changed", member.userId, { name: user.name, email: user.email, from: previousRole, to: member.role });
        },
      },
    }),
  ];

  const billingPlugins = stripeClient
    ? [
        stripe({
          stripeClient,
          stripeWebhookSecret: env.STRIPE_WEBHOOK_SECRET!,
          createCustomerOnSignUp: false,
          organization: { enabled: true },
          subscription: {
            enabled: true,
            plans: billing.plans,
            // only owners/admins of the organization may start or manage its subscription
            authorizeReference: async ({ user, referenceId }) => isOrgAdmin(db, user.id, referenceId),
          },
          async onEvent(event) {
            const object = event.data.object as { id?: string; status?: string };
            logger.info({ type: event.type, objectId: object.id, status: object.status }, "stripe webhook");
          },
        }),
      ]
    : [];

  /**
   * Checkout sells the plan on offer now (founder until the spots are taken) and only to a workspace that
   * isn't already subscribed; plan changes and cancellation happen in Stripe's billing portal.
   */
  const checkoutGuard = createAuthMiddleware(async (ctx) => {
    if (ctx.path !== "/subscription/upgrade" || !billing.enabled) return;
    const session = await getSessionFromCtx(ctx);
    const body = (ctx.body ?? {}) as { plan?: string; referenceId?: string; customerType?: string };
    const referenceId = body.referenceId ?? session?.session.activeOrganizationId;
    // the plugin refuses requests without a session or for someone else's workspace
    if (!session || !referenceId || !(await isOrgAdmin(db, session.user.id, referenceId))) return;
    if (body.customerType !== "organization") {
      throw new APIError("BAD_REQUEST", { code: "validation_failed", message: "Subscriptions belong to the workspace" });
    }
    if (await billing.isActive(referenceId)) {
      throw new APIError("BAD_REQUEST", { code: "already_subscribed", message: "This workspace is already subscribed. Manage the plan in Billing." });
    }
    if (body.plan?.toLowerCase() !== (await billing.offer())?.plan) {
      throw new APIError("BAD_REQUEST", { code: "plan_unavailable", message: "That price isn't available any more. Reload to see the current one." });
    }
  });

  /**
   * An invitation's id is what accepts it (with an account on the invited address, which sign-up doesn't verify), so
   * only the people who can send invitations get to read the ids: owners and admins. Better Auth's own endpoints
   * would list them to every member.
   */
  const invitationListGuard = createAuthMiddleware(async (ctx) => {
    if (ctx.path !== "/organization/list-invitations") return;
    const session = await getSessionFromCtx(ctx);
    const organizationId = (ctx.query as { organizationId?: string } | undefined)?.organizationId || session?.session.activeOrganizationId;
    // without a session or a workspace the endpoint refuses by itself
    if (!session || !organizationId) return;
    if (!(await isOrgAdmin(db, session.user.id, organizationId))) {
      throw new APIError("FORBIDDEN", { code: "forbidden", message: "Only owners and admins can see invitations" });
    }
  });

  /** The workspace as a member sees it: its people, without the pending invitations. */
  const invitationListStrip = createAuthMiddleware(async (ctx) => {
    if (ctx.path !== "/organization/get-full-organization") return;
    const returned = ctx.context.returned as { id?: unknown; invitations?: unknown } | null | undefined;
    if (!returned || returned instanceof Error || typeof returned.id !== "string" || !Array.isArray(returned.invitations)) return;
    const session = await getSessionFromCtx(ctx);
    if (session && (await isOrgAdmin(db, session.user.id, returned.id))) return;
    return ctx.json({ ...returned, invitations: [] });
  });

  return betterAuth({
    appName: brand.name,
    baseURL: env.BETTER_AUTH_URL,
    basePath: "/api/auth",
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins,
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: {
        user: users,
        session: sessions,
        account: accounts,
        verification: verifications,
        organization: organizations,
        member: members,
        invitation: invitations,
        subscription: subscriptions,
      },
    }),
    // Google sign-in comes later; email + password for now (no verification email yet).
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 10,
      autoSignIn: true,
      // the link goes through /api/auth/reset-password/:token, which checks it and opens the dashboard's page
      async sendResetPassword({ user, url }) {
        await mailer.send(resetPasswordEmail(user.email, user.name, url));
      },
      resetPasswordTokenExpiresIn: 60 * 60,
      // a reset signs out every other session, in case the old password leaked
      revokeSessionsOnPasswordReset: true,
    },
    databaseHooks: {
      user: {
        create: {
          // invite-only sign-ups: a beta invite, or a pending invitation to someone's workspace
          async before(user) {
            if (env.SIGNUPS !== "invite") return;
            const email = user.email.toLowerCase();
            const now = new Date();
            const [invite] = await db
              .select({ email: betaInvites.email })
              .from(betaInvites)
              .where(and(eq(betaInvites.email, email), gt(betaInvites.until, now)))
              .limit(1);
            const [invitation] = invite
              ? [invite]
              : await db
                  .select({ email: invitations.email })
                  .from(invitations)
                  .where(and(eq(sql`lower(${invitations.email})`, email), eq(invitations.status, "pending"), gt(invitations.expiresAt, now)))
                  .limit(1);
            // a partner's claim link for this address also lets its owner in
            if (!invitation && !(await hasPartnerClaim(email))) {
              throw new APIError("FORBIDDEN", {
                code: "signups_closed",
                message: `${brand.name} is in a closed beta. Ask for an invite at hello@${brand.domain}.`,
              });
            }
          },
          // Every account starts with its own workspace, so onboarding can go straight to "Add app". An owner
          // signing up from a partner's claim link joins that workspace instead (the claim page accepts it).
          async after(user) {
            if (await hasPartnerClaim(user.email)) return;
            const organizationId = uuidv7();
            const name = `${user.name.split(" ")[0] || "My"}'s workspace`;
            await db.transaction(async (tx) => {
              await tx.insert(organizations).values({
                id: organizationId,
                name,
                slug: `${slugify(user.name)}-${base62(6).toLowerCase()}`,
              });
              await tx.insert(members).values({ id: uuidv7(), organizationId, userId: user.id, role: "owner" });
              // a beta invite gives the new workspace beta access (it counts as subscribed until the invite's date)
              const [invite] = await tx
                .update(betaInvites)
                .set({ usedAt: new Date() })
                .where(and(eq(betaInvites.email, user.email.toLowerCase()), gt(betaInvites.until, new Date())))
                .returning();
              if (invite) await tx.insert(betaAccess).values({ organizationId, until: invite.until, note: invite.note });
              // Sign-up creates its session before this hook runs, so point that session at the new workspace too.
              await tx
                .update(sessions)
                .set({ activeOrganizationId: organizationId })
                .where(and(eq(sessions.userId, user.id), isNull(sessions.activeOrganizationId)));
            });
          },
        },
      },
      session: {
        create: {
          // New sessions open on the user's oldest workspace.
          async before(session) {
            if (session.activeOrganizationId) return;
            const [membership] = await db
              .select({ organizationId: members.organizationId })
              .from(members)
              .where(eq(members.userId, session.userId))
              .orderBy(asc(members.createdAt))
              .limit(1);
            if (membership) return { data: { ...session, activeOrganizationId: membership.organizationId } };
          },
        },
      },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        await checkoutGuard(ctx);
        await invitationListGuard(ctx);
      }),
      after: invitationListStrip,
    },
    plugins: [...plugins, ...billingPlugins],
  });
}

export type Auth = ReturnType<typeof createAuth>;
