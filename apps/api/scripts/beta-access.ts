/*
 * Invites testers to the closed beta, and grants, revokes or lists their access: a workspace with access counts
 * as subscribed until its date. An invite also lets the address sign up while sign-ups are invite-only
 * (SIGNUPS=invite); its workspace gets access when it's created. Runs against the database directly (an
 * operator tool, not an API) and records grants and revokes in the workspace's audit log.
 *
 *   DATABASE_URL=… npx tsx apps/api/scripts/beta-access.ts --email tester@example.com --until 2027-03-31 [--note "Indie dev, Lockd"]
 *   DATABASE_URL=… npx tsx apps/api/scripts/beta-access.ts --email tester@example.com --revoke
 *   DATABASE_URL=… npx tsx apps/api/scripts/beta-access.ts --list
 *
 * --email names a person: before they sign up it's an invite; after, access goes to every workspace they own.
 */
import { parseArgs } from "node:util";
import { uuidv7 } from "@hshelby/core";
import { auditEvents, betaAccess, betaInvites, createDb, members, organizations, users } from "@hshelby/db";
import { and, asc, eq } from "drizzle-orm";

const { values: args } = parseArgs({
  options: { email: { type: "string" }, until: { type: "string" }, note: { type: "string" }, revoke: { type: "boolean" }, list: { type: "boolean" } },
});

/** The end of the given day, UTC; it must be in the future. */
function endOfDay(day: string) {
  const until = new Date(`${day}T23:59:59Z`);
  if (Number.isNaN(until.getTime()) || until <= new Date()) {
    console.error("--until must be a future date, YYYY-MM-DD.");
    process.exit(2);
  }
  return until;
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("Set DATABASE_URL.");
  process.exit(2);
}
const { db, pool } = createDb(url);

async function main() {
  if (args.list) {
    const invites = await db.select().from(betaInvites).orderBy(asc(betaInvites.createdAt));
    for (const i of invites.filter((i) => !i.usedAt)) {
      console.log(`${i.email}  invited, not signed up yet  until ${i.until.toISOString().slice(0, 10)}${i.note ? `  ${i.note}` : ""}`);
    }
    const rows = await db
      .select({ workspace: organizations.name, until: betaAccess.until, note: betaAccess.note, grantedAt: betaAccess.grantedAt })
      .from(betaAccess)
      .innerJoin(organizations, eq(organizations.id, betaAccess.organizationId))
      .orderBy(asc(betaAccess.until));
    if (!rows.length) console.log("No workspaces have beta access.");
    for (const r of rows) {
      const state = r.until > new Date() ? "active" : "ended";
      console.log(`${r.workspace}  until ${r.until.toISOString().slice(0, 10)} (${state})${r.note ? `  ${r.note}` : ""}`);
    }
    return;
  }

  const email = args.email?.trim().toLowerCase();
  if (!email || (!args.revoke && !args.until)) {
    console.error("Usage: --email <address> (--until YYYY-MM-DD [--note text] | --revoke), or --list");
    process.exit(2);
  }
  const owned = await db
    .select({ organizationId: members.organizationId, workspace: organizations.name })
    .from(members)
    .innerJoin(users, eq(users.id, members.userId))
    .innerJoin(organizations, eq(organizations.id, members.organizationId))
    .where(and(eq(users.email, email), eq(members.role, "owner")));
  if (args.revoke) {
    await db.delete(betaInvites).where(eq(betaInvites.email, email));
    if (!owned.length) console.log(`Withdrew the beta invite for ${email}.`);
  } else {
    const until = endOfDay(args.until!);
    const note = args.note?.trim() || null;
    // kept after sign-up too, as the record of who was invited
    await db
      .insert(betaInvites)
      .values({ email, until, note })
      .onConflictDoUpdate({ target: betaInvites.email, set: { until, note } });
    if (!owned.length) console.log(`Invited ${email}: they can sign up now, and their workspace gets beta access until ${args.until}.`);
  }

  for (const { organizationId, workspace } of owned) {
    if (args.revoke) {
      await db.delete(betaAccess).where(eq(betaAccess.organizationId, organizationId));
      await db.insert(auditEvents).values({ id: uuidv7(), organizationId, userId: null, action: "billing.beta_revoked", target: organizationId, metadata: {} });
      console.log(`Revoked beta access for ${workspace}.`);
      continue;
    }
    const until = endOfDay(args.until!);
    const note = args.note?.trim() || null;
    await db
      .insert(betaAccess)
      .values({ organizationId, until, note })
      .onConflictDoUpdate({ target: betaAccess.organizationId, set: { until, note, grantedAt: new Date() } });
    await db.insert(auditEvents).values({
      id: uuidv7(),
      organizationId,
      userId: null,
      action: "billing.beta_granted",
      target: organizationId,
      metadata: { until: until.toISOString(), ...(note && { note }) },
    });
    console.log(`${workspace} has beta access until ${args.until}.`);
  }
}

await main().finally(() => pool.end());
