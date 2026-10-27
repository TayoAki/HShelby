import { uuidv7 } from "@hshelby/core";
import { createDb, invitations, organizations, sessions, users, verifications } from "@hshelby/db";
import { eq } from "drizzle-orm";
import { afterAll, expect, it } from "vitest";
import { runCleanup } from "../src/jobs/cleanup";

const { db, pool } = createDb(process.env.TEST_DATABASE_URL ?? "postgres://postgres@localhost:5433/hshelby_test");
afterAll(() => pool.end());

it("removes expired sessions/verifications and expires old invitations, keeping live rows", async () => {
  const now = new Date("2026-10-27T03:00:00Z");
  const old = new Date(now.getTime() - 3 * 86_400_000);
  const future = new Date(now.getTime() + 86_400_000);
  const userId = uuidv7();
  const orgId = uuidv7();
  await db.insert(users).values({ id: userId, name: "Cleanup", email: `${userId}@example.com` });
  await db.insert(organizations).values({ id: orgId, name: "Cleanup org", slug: `cleanup-${userId}` });
  await db.insert(sessions).values([
    { id: `old-${userId}`, token: `old-${userId}`, userId, expiresAt: old, updatedAt: old },
    { id: `live-${userId}`, token: `live-${userId}`, userId, expiresAt: future, updatedAt: now },
  ]);
  await db.insert(verifications).values({ id: `v-${userId}`, identifier: "x", value: "y", expiresAt: old });
  await db.insert(invitations).values({ id: `i-${userId}`, organizationId: orgId, email: "a@example.com", expiresAt: old, inviterId: userId });

  const removed = await runCleanup(db, now);
  expect(removed.sessions).toBeGreaterThanOrEqual(1);
  expect(removed.verifications).toBeGreaterThanOrEqual(1);
  expect(removed.invitations).toBeGreaterThanOrEqual(1);

  const left = await db.select({ id: sessions.id }).from(sessions).where(eq(sessions.userId, userId));
  expect(left.map((s) => s.id)).toEqual([`live-${userId}`]);
  const [inv] = await db.select().from(invitations).where(eq(invitations.id, `i-${userId}`));
  expect(inv!.status).toBe("expired");
});
