import { AuditQuery, customerLabel, type AuditEvent } from "@hshelby/contracts";
import { apps, auditEvents, devices, users } from "@hshelby/db";
import { and, desc, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import type { AppEnv, Deps } from "../context";
import { ApiError } from "../errors";
import { requireOrgAdmin } from "../middleware";
import { isUuid, parseQuery } from "../validation";

/** Keyset cursor over (created_at, id), newest first. */
const encodeCursor = (e: { createdAt: Date; id: string }) => Buffer.from(`${e.createdAt.toISOString()}|${e.id}`).toString("base64url");

function decodeCursor(cursor: string) {
  const [at, id] = Buffer.from(cursor, "base64url").toString().split("|");
  if (!at || !id || !isUuid(id) || Number.isNaN(Date.parse(at))) throw new ApiError(400, "validation_failed", "cursor: invalid");
  return { at, id };
}

/** The workspace's audit log under /api/audit, for owners and admins (phase B12). */
export function auditRoutes(deps: Deps) {
  const { db } = deps;
  const r = new Hono<AppEnv>();

  r.get("/audit", requireOrgAdmin, async (c) => {
    const query = parseQuery(c, AuditQuery);
    const cursor = query.cursor ? decodeCursor(query.cursor) : null;
    const rows = await db
      .select({
        event: auditEvents,
        actor: { id: users.id, name: users.name, email: users.email },
        app: apps.name,
        device: devices,
      })
      .from(auditEvents)
      .leftJoin(users, eq(users.id, auditEvents.userId))
      // a target is an app, a device or a teammate, by ID; deleted ones keep their event without a label
      .leftJoin(apps, sql`${apps.id}::text = ${auditEvents.target}`)
      .leftJoin(devices, sql`${devices.id}::text = ${auditEvents.target}`)
      .where(
        and(
          eq(auditEvents.organizationId, c.get("org").id),
          cursor ? sql`(${auditEvents.createdAt}, ${auditEvents.id}) < (${cursor.at}::timestamptz, ${cursor.id}::uuid)` : undefined,
        ),
      )
      .orderBy(desc(auditEvents.createdAt), desc(auditEvents.id))
      .limit(query.limit + 1);
    const page = rows.slice(0, query.limit);
    const events: AuditEvent[] = page.map(({ event, actor, app, device }) => ({
      id: event.id,
      action: event.action,
      actor: actor?.id ? { id: actor.id, name: actor.name, email: actor.email } : null,
      target: event.target
        ? { id: event.target, label: app ?? (device ? customerLabel({ ...device, userId: device.userIdExt }) : null) }
        : null,
      metadata: (event.metadata as Record<string, unknown> | null) ?? null,
      createdAt: event.createdAt.toISOString(),
    }));
    return c.json({ events, nextCursor: rows.length > query.limit ? encodeCursor(page.at(-1)!.event) : null });
  });

  return r;
}
