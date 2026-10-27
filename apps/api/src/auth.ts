import { stripe } from "@better-auth/stripe";
import { brand } from "@hshelby/contracts";
import { base62, uuidv7 } from "@hshelby/core";
import {
  accounts,
  invitations,
  members,
  organizations,
  sessions,
  subscriptions,
  users,
  verifications,
  type Db,
} from "@hshelby/db";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { organization } from "better-auth/plugins/organization";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import type { Logger } from "pino";
import Stripe from "stripe";
import { billingEnabled, type Env } from "./env";

export const BILLING_PLAN = "founder";

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

export function createAuth({ db, env, logger }: { db: Db; env: Env; logger: Logger }) {
  const trustedOrigins = [env.BETTER_AUTH_URL, ...(env.TRUSTED_ORIGINS?.split(",").map((s) => s.trim()) ?? [])];

  const plugins = [
    organization({
      // B0 has no email provider yet: log the invitation instead of sending it.
      async sendInvitationEmail(data) {
        logger.info(
          { invitationId: data.id, organizationId: data.organization.id, email: data.email },
          "invitation created (email delivery not configured)",
        );
      },
    }),
  ];

  const billing = billingEnabled(env)
    ? [
        stripe({
          stripeClient: new Stripe(env.STRIPE_SECRET_KEY!),
          stripeWebhookSecret: env.STRIPE_WEBHOOK_SECRET!,
          createCustomerOnSignUp: false,
          organization: { enabled: true },
          subscription: {
            enabled: true,
            plans: [{ name: BILLING_PLAN, priceId: env.STRIPE_PRICE_MONTHLY, annualDiscountPriceId: env.STRIPE_PRICE_YEARLY }],
            // only owners/admins of the organization may start or manage its subscription
            authorizeReference: async ({ user, referenceId }) => isOrgAdmin(db, user.id, referenceId),
          },
        }),
      ]
    : [];

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
    emailAndPassword: { enabled: true, minPasswordLength: 10, autoSignIn: true },
    databaseHooks: {
      user: {
        create: {
          // Every account starts with its own workspace, so onboarding can go straight to "Add app".
          async after(user) {
            const organizationId = uuidv7();
            const name = `${user.name.split(" ")[0] || "My"}'s workspace`;
            await db.transaction(async (tx) => {
              await tx.insert(organizations).values({
                id: organizationId,
                name,
                slug: `${slugify(user.name)}-${base62(6).toLowerCase()}`,
              });
              await tx.insert(members).values({ id: uuidv7(), organizationId, userId: user.id, role: "owner" });
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
    plugins: [...plugins, ...billing],
  });
}

export type Auth = ReturnType<typeof createAuth>;
