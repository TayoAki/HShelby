import { createHash } from "node:crypto";
import { partnerWorkspaces, type Db, type Tx } from "@hshelby/db";
import { eq } from "drizzle-orm";

/*
 * Partners (App Builder) and the workspaces they create through the partner API (src/routes/partner.ts). A
 * partner workspace is billed by the partner: it counts as subscribed while `active`, and AI replies stop when
 * `aiAllowed` is off. Its owner joins with a one-time claim link (src/routes/partner-claims.ts).
 */

const DISPLAY_NAMES: Record<string, string> = { appbuilder: "App Builder" };

/** How people see the partner: "appbuilder" → "App Builder". */
export const partnerDisplayName = (name: string) =>
  DISPLAY_NAMES[name] ??
  name
    .split("-")
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join(" ");

/** Claim tokens are stored only as their SHA-256. */
export const hashClaimToken = (token: string) => createHash("sha256").update(token).digest("hex");

/** The organization's partner workspace row, if a partner created it. */
export async function partnerWorkspaceOf(db: Db | Tx, organizationId: string) {
  const [row] = await db.select().from(partnerWorkspaces).where(eq(partnerWorkspaces.organizationId, organizationId)).limit(1);
  return row ?? null;
}
