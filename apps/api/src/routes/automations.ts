import { customerLabel, AutomationInput, type Automation, type AutomationResults, type RunReason, type RunStatus } from "@hshelby/contracts";
import { uuidv7 } from "@hshelby/core";
import { automationRuns, automations, devices, members } from "@hshelby/db";
import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import type { AppEnv, Deps } from "../context";
import { ApiError, notFound } from "../errors";
import { requireOrgAdmin } from "../middleware";
import { isUuid, parseJson } from "../validation";
import { findOrgApp } from "./apps";

type Row = typeof automations.$inferSelect;

const toAutomation = (a: Row): Automation => ({
  ...a.definition,
  id: a.id,
  name: a.name,
  enabled: a.enabled,
  createdAt: a.createdAt.toISOString(),
  updatedAt: a.updatedAt.toISOString(),
});

/** An app's automations under /api/apps/:id/automations. Admins edit; members read. */
export function automationRoutes(deps: Deps) {
  const { db } = deps;
  const r = new Hono<AppEnv>();

  async function find(orgId: string, appId: string, id: string) {
    const app = await findOrgApp(db, orgId, appId);
    if (!isUuid(id)) throw notFound("Automation");
    const [row] = await db.select().from(automations).where(and(eq(automations.id, id), eq(automations.appId, app.id)));
    if (!row) throw notFound("Automation");
    return { app, row };
  }

  /** The sender must be a teammate in this workspace. */
  async function checkSender(orgId: string, senderUserId: string | null) {
    if (!senderUserId) return;
    const [member] = await db.select({ id: members.id }).from(members).where(and(eq(members.organizationId, orgId), eq(members.userId, senderUserId)));
    if (!member) throw new ApiError(400, "validation_failed", "senderUserId: not a member of this workspace");
  }

  r.get("/:id/automations", async (c) => {
    const app = await findOrgApp(db, c.get("org").id, c.req.param("id"));
    const rows = await db.select().from(automations).where(eq(automations.appId, app.id)).orderBy(desc(automations.createdAt));
    return c.json({ automations: rows.map(toAutomation) });
  });

  r.post("/:id/automations", requireOrgAdmin, async (c) => {
    const input = await parseJson(c, AutomationInput);
    const org = c.get("org");
    const app = await findOrgApp(db, org.id, c.req.param("id"));
    await checkSender(org.id, input.senderUserId);
    const [row] = await db
      .insert(automations)
      .values({
        id: uuidv7(),
        appId: app.id,
        name: input.name,
        enabled: input.enabled,
        triggerEvent: input.trigger.event,
        definition: input,
        senderUserId: input.senderUserId,
        createdBy: c.get("user").id,
      })
      .returning();
    return c.json({ automation: toAutomation(row!) }, 201);
  });

  /** Editing never re-sends: runs already scheduled continue with the new steps from where they are. */
  r.put("/:id/automations/:automationId", requireOrgAdmin, async (c) => {
    const input = await parseJson(c, AutomationInput);
    const org = c.get("org");
    const { row } = await find(org.id, c.req.param("id"), c.req.param("automationId"));
    await checkSender(org.id, input.senderUserId);
    const [updated] = await db
      .update(automations)
      .set({ name: input.name, enabled: input.enabled, triggerEvent: input.trigger.event, definition: input, senderUserId: input.senderUserId, updatedAt: new Date() })
      .where(eq(automations.id, row.id))
      .returning();
    return c.json({ automation: toAutomation(updated!) });
  });

  /** Deleting keeps the messages it sent; scheduled runs stop. */
  r.delete("/:id/automations/:automationId", requireOrgAdmin, async (c) => {
    const { row } = await find(c.get("org").id, c.req.param("id"), c.req.param("automationId"));
    await db.delete(automations).where(eq(automations.id, row.id));
    return c.body(null, 204);
  });

  /**
   * Results: who got a message, then opened the offer or tapped Rate, replied, or bought within 7 days; plus the
   * scheduled queue and the skipped list with reasons.
   */
  r.get("/:id/automations/:automationId/results", async (c) => {
    const { row } = await find(c.get("org").id, c.req.param("id"), c.req.param("automationId"));
    const sentRuns = await db
      .select({
        id: automationRuns.id,
        deviceId: automationRuns.deviceId,
        // qualified by hand: drizzle leaves a single table's columns unqualified, which the subqueries would shadow
        opened: sql<boolean>`exists (select 1 from messages m where m.id = any(automation_runs.message_ids) and m.action_clicked_at is not null)`,
        replied: sql<boolean>`exists (select 1 from messages m join conversations c on c.id = m.conversation_id
          where c.device_id = automation_runs.device_id and m.sender = 'user' and m.created_at > automation_runs.first_sent_at)`,
        bought: sql<boolean>`exists (select 1 from provider_events e where e.device_ids @> array[automation_runs.device_id]
          and e.event in ('trial_started', 'subscription_started', 'trial_converted')
          and e.received_at between automation_runs.first_sent_at and automation_runs.first_sent_at + interval '7 days')`,
      })
      .from(automationRuns)
      .where(and(eq(automationRuns.automationId, row.id), isNotNull(automationRuns.firstSentAt)));

    const people = async (statuses: RunStatus[]) =>
      db
        .select({ run: automationRuns, device: devices })
        .from(automationRuns)
        .innerJoin(devices, eq(devices.id, automationRuns.deviceId))
        .where(and(eq(automationRuns.automationId, row.id), inArray(automationRuns.status, statuses)))
        .orderBy(desc(automationRuns.updatedAt))
        .limit(50);
    const label = (d: typeof devices.$inferSelect) => customerLabel({ ...d, userId: d.userIdExt });

    const results: AutomationResults = {
      sent: sentRuns.length,
      opened: sentRuns.filter((x) => x.opened).length,
      replied: sentRuns.filter((x) => x.replied).length,
      bought: sentRuns.filter((x) => x.bought).length,
      scheduled: (await people(["scheduled"])).map(({ run, device }) => ({
        runId: run.id,
        deviceId: device.id,
        person: label(device),
        nextAt: run.nextAt!.toISOString(),
        step: run.stepIndex,
      })),
      skipped: (await people(["skipped", "held", "ended"]))
        .filter(({ run }) => run.reason)
        .map(({ run, device }) => ({
          runId: run.id,
          deviceId: device.id,
          person: label(device),
          reason: run.reason as RunReason,
          at: run.updatedAt.toISOString(),
          status: run.status,
        })),
    };
    return c.json(results);
  });

  return r;
}
