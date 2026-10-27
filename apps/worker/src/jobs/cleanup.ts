import { invitations, sessions, verifications, type Db } from "@hshelby/db";
import { and, eq, lt } from "drizzle-orm";

const DAY = 24 * 60 * 60 * 1000;

/** Nightly housekeeping: expired sessions, verification tokens and stale invitations. */
export async function runCleanup(db: Db, now = new Date()) {
  const cutoff = new Date(now.getTime() - DAY);
  const expiredSessions = await db.delete(sessions).where(lt(sessions.expiresAt, cutoff)).returning({ id: sessions.id });
  const expiredVerifications = await db
    .delete(verifications)
    .where(lt(verifications.expiresAt, cutoff))
    .returning({ id: verifications.id });
  const expiredInvitations = await db
    .update(invitations)
    .set({ status: "expired" })
    .where(and(eq(invitations.status, "pending"), lt(invitations.expiresAt, now)))
    .returning({ id: invitations.id });
  return {
    sessions: expiredSessions.length,
    verifications: expiredVerifications.length,
    invitations: expiredInvitations.length,
  };
}
