import type { AiUsage } from "@hshelby/contracts";
import { aiUsage, partnerApps, partnerWorkspaces, type Db, type Tx } from "@hshelby/db";
import { and, count, eq, gte, sql } from "drizzle-orm";

/*
 * The cost ledger (`ai_usage`): one row per model call that used tokens. Unlike `ai_runs` it outlives the
 * conversation, device and app it was for, so the ceilings below can't be reset by registering another device or
 * deleting one, and a partner's bill doesn't lose runs to a deletion.
 */

type Entry = { id: string; organizationId: string; appId: string; kind: "reply" | "preview"; model: string | null; usage: AiUsage };

/** Writes the call's cost, with the partner's ids for the workspace and app if a partner made them. */
export async function recordAiUsage(db: Db | Tx, entry: Entry) {
  const { usage } = entry;
  if (usage.inputTokens + usage.outputTokens + usage.cacheReadTokens + usage.cacheWriteTokens <= 0) return;
  const [workspace] = await db
    .select({ partner: partnerWorkspaces.partner, externalId: partnerWorkspaces.externalId })
    .from(partnerWorkspaces)
    .where(eq(partnerWorkspaces.organizationId, entry.organizationId))
    .limit(1);
  const [app] = workspace
    ? await db
        .select({ externalId: partnerApps.externalId })
        .from(partnerApps)
        .where(and(eq(partnerApps.appId, entry.appId), eq(partnerApps.partner, workspace.partner)))
        .limit(1)
    : [];
  await db.insert(aiUsage).values({
    id: entry.id,
    organizationId: entry.organizationId,
    appId: entry.appId,
    kind: entry.kind,
    partner: workspace?.partner ?? null,
    workspaceExternalId: workspace?.externalId ?? null,
    appExternalId: app?.externalId ?? null,
    model: entry.model,
    ...usage,
  });
}

const lastDay = sql`now() - interval '1 day'`;

/** Model calls for the app's conversations in the last 24 hours, whoever's they were. */
export async function appRepliesLastDay(db: Db | Tx, appId: string) {
  const [row] = await db
    .select({ n: count() })
    .from(aiUsage)
    .where(and(eq(aiUsage.appId, appId), eq(aiUsage.kind, "reply"), gte(aiUsage.createdAt, lastDay)));
  return row!.n;
}

/** The workspace's "Try it" model calls in the last 24 hours. */
export async function workspacePreviewsLastDay(db: Db | Tx, organizationId: string) {
  const [row] = await db
    .select({ n: count() })
    .from(aiUsage)
    .where(and(eq(aiUsage.organizationId, organizationId), eq(aiUsage.kind, "preview"), gte(aiUsage.createdAt, lastDay)));
  return row!.n;
}
