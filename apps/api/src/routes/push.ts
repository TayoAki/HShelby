import { PushConfigInput, type PushConfig, type PushSettings, type PushTestResults } from "@hshelby/contracts";
import { encryptSecret, uuidv7 } from "@hshelby/core";
import { auditEvents, devices, pushConfigs } from "@hshelby/db";
import { assertValidP8, sendTestPushes } from "@hshelby/push";
import { and, count, eq, isNotNull, isNull } from "drizzle-orm";
import { Hono } from "hono";
import type { AppEnv, Deps } from "../context";
import { ApiError } from "../errors";
import { requireOrgAdmin } from "../middleware";
import { parseJson } from "../validation";
import { findOrgApp } from "./apps";

type PushConfigRow = typeof pushConfigs.$inferSelect;

/** Everything but the key: the .p8 never leaves the server once uploaded. */
const toDto = (c: PushConfigRow): PushConfig => ({
  teamId: c.teamId,
  keyId: c.keyId,
  bundleId: c.bundleId,
  titleTemplate: c.titleTemplate,
  bodyTemplate: c.bodyTemplate,
  senderName: c.senderName,
  showPreview: c.showPreview,
  sound: c.sound,
  issue: c.issue,
  issueAt: c.issueAt?.toISOString() ?? null,
  updatedAt: c.updatedAt.toISOString(),
});

/** An app's push notification settings, under /api/apps/:id/push. Changes are admin-only and audited. */
export function pushRoutes(deps: Deps) {
  const { db } = deps;
  const r = new Hono<AppEnv>();

  r.get("/:id/push", async (c) => {
    const app = await findOrgApp(db, c.get("org").id, c.req.param("id"));
    const [config] = await db.select().from(pushConfigs).where(eq(pushConfigs.appId, app.id));
    const [reachable] = await db
      .select({ n: count() })
      .from(devices)
      .where(and(eq(devices.appId, app.id), isNotNull(devices.pushToken), isNull(devices.signedOutAt)));
    return c.json({ config: config ? toDto(config) : null, reachableDevices: reachable!.n } satisfies PushSettings);
  });

  r.put("/:id/push", requireOrgAdmin, async (c) => {
    const input = await parseJson(c, PushConfigInput);
    const org = c.get("org");
    const app = await findOrgApp(db, org.id, c.req.param("id"));
    const [existing] = await db.select().from(pushConfigs).where(eq(pushConfigs.appId, app.id));

    let p8Enc = existing?.p8Enc;
    if (input.p8) {
      try {
        await assertValidP8(input.p8);
      } catch {
        throw new ApiError(400, "invalid_push_key", "That isn't an APNs auth key. Upload the .p8 file from your Apple Developer account.");
      }
      p8Enc = encryptSecret(input.p8, deps.keyring);
    }
    if (!p8Enc) throw new ApiError(400, "validation_failed", "p8: upload the .p8 key file");

    const values = {
      teamId: input.teamId,
      keyId: input.keyId,
      bundleId: input.bundleId,
      p8Enc,
      titleTemplate: input.titleTemplate,
      bodyTemplate: input.bodyTemplate,
      senderName: input.senderName,
      showPreview: input.showPreview,
      sound: input.sound,
      // new credentials deserve a fresh verdict from APNs
      ...((input.p8 || input.teamId !== existing?.teamId || input.keyId !== existing?.keyId) && { issue: null, issueAt: null }),
      updatedAt: new Date(),
    };
    const config = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(pushConfigs)
        .values({ appId: app.id, ...values })
        .onConflictDoUpdate({ target: pushConfigs.appId, set: values })
        .returning();
      await tx.insert(auditEvents).values({
        id: uuidv7(),
        organizationId: org.id,
        userId: c.get("user").id,
        action: input.p8 ? "app.push.key_uploaded" : "app.push.updated",
        target: app.id,
      });
      return row!;
    });
    return c.json({ config: toDto(config) });
  });

  r.delete("/:id/push", requireOrgAdmin, async (c) => {
    const org = c.get("org");
    const app = await findOrgApp(db, org.id, c.req.param("id"));
    await db.transaction(async (tx) => {
      const removed = await tx.delete(pushConfigs).where(eq(pushConfigs.appId, app.id)).returning({ appId: pushConfigs.appId });
      if (removed.length > 0) {
        await tx
          .insert(auditEvents)
          .values({ id: uuidv7(), organizationId: org.id, userId: c.get("user").id, action: "app.push.removed", target: app.id });
      }
    });
    return c.body(null, 204);
  });

  /** Sends a sample notification to up to 10 recently active devices and reports each result. */
  r.post("/:id/push/test", requireOrgAdmin, async (c) => {
    const app = await findOrgApp(db, c.get("org").id, c.req.param("id"));
    const sent = await sendTestPushes({ db, apns: deps.apns, keyring: deps.keyring }, app);
    if (!sent) throw new ApiError(409, "push_not_configured", "Upload an APNs key first");
    const results: PushTestResults["results"] = sent.map(({ device, environment, result }) => ({
      deviceId: device.id,
      label: device.name ?? device.email ?? device.userIdExt ?? `Device ${device.id.slice(-4).toUpperCase()}`,
      environment,
      ok: result.ok,
      reason: result.ok ? null : result.reason,
    }));
    return c.json({ results } satisfies PushTestResults);
  });

  return r;
}
