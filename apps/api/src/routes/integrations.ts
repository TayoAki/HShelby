import {
  ConnectIntegrationInput,
  PAYING_AFTER,
  Provider,
  STICKY_METADATA_KEYS,
  type DeviceSubscription,
  type IntegrationState,
  type ProviderEventLog,
  type ProviderEventStatus,
  type SubscriptionEvent,
} from "@hshelby/contracts";
import { decryptSecret, encryptSecret, uuidv7 } from "@hshelby/core";
import { apps, auditEvents, devices, providerEvents, providerIntegrations, pushConfigs, type Db, type Tx } from "@hshelby/db";
import {
  checkAuthorization,
  checkSvixSignature,
  isAdaptyUrlCheck,
  JwsRejected,
  newAuthorizationValue,
  normalizeAdapty,
  normalizeAppStore,
  normalizeRevenueCat,
  normalizeSuperwall,
  PayloadRejected,
  SignatureRejected,
  type JwsOptions,
  type Normalized,
} from "@hshelby/subscriptions";
import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import type { AppEnv, Deps } from "../context";
import { ApiError, isUniqueViolation, notFound } from "../errors";
import { isAdminRole, requireOrgAdmin } from "../middleware";
import { parseJson } from "../validation";
import { findOrgApp } from "./apps";

/** The sticky metadata key that holds the provider's own ID for the person. */
const PROVIDER_ID_KEY: Record<Provider, (typeof STICKY_METADATA_KEYS)[number] | null> = {
  revenuecat: "revenuecat_id",
  superwall: "superwall_id",
  adapty: "adapty_id",
  appstore: null,
};

const SUBSCRIPTION_STATUS: Record<SubscriptionEvent, DeviceSubscription["status"]> = {
  trial_started: "trial",
  trial_converted: "active",
  trial_cancelled: "cancelled",
  trial_expired: "expired",
  subscription_started: "active",
  subscription_renewed: "active",
  subscription_cancelled: "cancelled",
  billing_issue: "billing_issue",
  subscription_expired: "expired",
  refunded: "refunded",
};

const webhookUrl = (deps: Deps, provider: Provider, publicId: string) =>
  `${(deps.env.PUBLIC_API_URL ?? "").replace(/\/$/, "")}/webhooks/${provider}/${publicId}`;

/** Provider connections and the Recent events log, under /api/apps/:id. Admins connect and see secrets. */
export function integrationRoutes(deps: Deps) {
  const { db } = deps;
  const r = new Hono<AppEnv>();

  async function states(app: { id: string; publicId: string }, admin: boolean): Promise<IntegrationState[]> {
    const rows = await db.select().from(providerIntegrations).where(eq(providerIntegrations.appId, app.id));
    return Provider.options.map((provider) => {
      const row = rows.find((x) => x.provider === provider);
      const secret = row?.secretEnc ? decryptSecret(row.secretEnc, deps.keyring) : null;
      return {
        provider,
        connected: Boolean(row),
        webhookUrl: webhookUrl(deps, provider, app.publicId),
        authorization: admin && (provider === "revenuecat" || provider === "adapty") ? secret : null,
        hasSigningSecret: provider === "superwall" && Boolean(secret),
        lastEventAt: row?.lastEventAt?.toISOString() ?? null,
      };
    });
  }

  r.get("/:id/integrations", async (c) => {
    const org = c.get("org");
    const app = await findOrgApp(db, org.id, c.req.param("id"));
    c.header("Cache-Control", "no-store");
    return c.json({ integrations: await states(app, isAdminRole(org.role)) });
  });

  /**
   * Connects a provider: RevenueCat and Adapty get a fresh Authorization value to paste there; Superwall needs
   * its signing secret; the App Store needs nothing (Apple signs its notifications). Connecting again replaces it.
   */
  r.put("/:id/integrations/:provider", requireOrgAdmin, async (c) => {
    const org = c.get("org");
    const app = await findOrgApp(db, org.id, c.req.param("id"));
    const parsed = Provider.safeParse(c.req.param("provider"));
    if (!parsed.success) throw notFound("Provider");
    const provider = parsed.data;
    const input = await parseJson(c, ConnectIntegrationInput, { optional: true });
    let secret: string | null = null;
    if (provider === "superwall") {
      if (!input.signingSecret) throw new ApiError(400, "validation_failed", "signingSecret: paste Superwall's whsec_… signing secret");
      secret = input.signingSecret;
    } else if (provider !== "appstore") {
      secret = newAuthorizationValue();
    }
    const secretEnc = secret ? encryptSecret(secret, deps.keyring) : null;
    await db
      .insert(providerIntegrations)
      .values({ appId: app.id, provider, secretEnc })
      .onConflictDoUpdate({ target: [providerIntegrations.appId, providerIntegrations.provider], set: { secretEnc } });
    await db.insert(auditEvents).values({ id: uuidv7(), organizationId: org.id, userId: c.get("user").id, action: "integration.connected", target: app.id, metadata: { provider } });
    c.header("Cache-Control", "no-store");
    return c.json({ integrations: await states(app, true) });
  });

  r.delete("/:id/integrations/:provider", requireOrgAdmin, async (c) => {
    const org = c.get("org");
    const app = await findOrgApp(db, org.id, c.req.param("id"));
    const provider = Provider.safeParse(c.req.param("provider"));
    if (!provider.success) throw notFound("Provider");
    await db.delete(providerIntegrations).where(and(eq(providerIntegrations.appId, app.id), eq(providerIntegrations.provider, provider.data)));
    await db.insert(auditEvents).values({ id: uuidv7(), organizationId: org.id, userId: c.get("user").id, action: "integration.disconnected", target: app.id, metadata: { provider: provider.data } });
    return c.body(null, 204);
  });

  /** The Recent events log: what came in, what it meant, who it reached, or why it was refused. */
  r.get("/:id/provider-events", async (c) => {
    const app = await findOrgApp(db, c.get("org").id, c.req.param("id"));
    const rows = await db.select().from(providerEvents).where(eq(providerEvents.appId, app.id)).orderBy(desc(providerEvents.receivedAt)).limit(100);
    const events: ProviderEventLog[] = rows.map((e) => ({
      id: e.id,
      provider: e.provider,
      rawType: e.rawType,
      event: e.event,
      status: e.status,
      reason: e.reason,
      environment: e.environment,
      person: e.person,
      devicesReached: e.deviceIds.length,
      receivedAt: e.receivedAt.toISOString(),
    }));
    return c.json({ events });
  });

  return r;
}

/* ---------- receivers ---------- */

/**
 * The devices of the person an event is about: by the app's own user ID, the provider's sticky ID in metadata,
 * a StoreKit original transaction ID the SDK reported, or an App Store appAccountToken equal to the user ID; then
 * every other signed-in device with the same user ID.
 */
export async function matchDevices(db: Db | Tx, appId: string, provider: Provider, match: Normalized["match"]) {
  const key = PROVIDER_ID_KEY[provider];
  const conditions = [
    match.userIds.length ? inArray(devices.userIdExt, match.userIds) : undefined,
    key && match.providerIds.length ? inArray(sql`${devices.metadata}->>${key}`, match.providerIds) : undefined,
    match.originalTransactionId ? sql`${devices.originalTransactionIds} @> array[${match.originalTransactionId}]::text[]` : undefined,
    match.appAccountToken ? sql`lower(${devices.userIdExt}) = ${match.appAccountToken}` : undefined,
  ].filter(Boolean);
  if (conditions.length === 0) return [];
  const seeds = await db
    .select({ id: devices.id, userId: devices.userIdExt })
    .from(devices)
    .where(and(eq(devices.appId, appId), isNull(devices.signedOutAt), or(...conditions)));
  const people = [...new Set(seeds.map((d) => d.userId).filter((u): u is string => Boolean(u)))];
  const siblings = people.length
    ? await db
        .select({ id: devices.id })
        .from(devices)
        .where(and(eq(devices.appId, appId), isNull(devices.signedOutAt), inArray(devices.userIdExt, people)))
    : [];
  return [...new Set([...seeds, ...siblings].map((d) => d.id))];
}

type Receiver = { app: typeof apps.$inferSelect; secret: string | null; bundleId: string | null };

/** Provider webhooks at /webhooks/:provider/:appId (the public App ID). */
export function providerWebhookRoutes(deps: Deps, jwsOptions: JwsOptions = {}) {
  const { db } = deps;
  const r = new Hono();

  const log = (appId: string, provider: Provider, status: ProviderEventStatus, reason: string, n?: Partial<Normalized>) =>
    db.insert(providerEvents).values({
      id: uuidv7(),
      appId,
      provider,
      providerEventId: null,
      rawType: n?.rawType ?? null,
      event: n?.event ?? null,
      status,
      reason,
      environment: n?.environment ?? null,
      person: n?.person ?? null,
    });

  async function receiver(provider: Provider, publicId: string): Promise<Receiver | null> {
    const [row] = await db
      .select({ app: apps, secretEnc: providerIntegrations.secretEnc, connected: providerIntegrations.appId, pushBundle: pushConfigs.bundleId })
      .from(apps)
      .leftJoin(providerIntegrations, and(eq(providerIntegrations.appId, apps.id), eq(providerIntegrations.provider, provider)))
      .leftJoin(pushConfigs, eq(pushConfigs.appId, apps.id))
      .where(and(eq(apps.publicId, publicId), isNull(apps.deletedAt)));
    if (!row) return null;
    if (!row.connected) {
      await log(row.app.id, provider, "refused", "not connected");
      throw new ApiError(404, "integration_not_connected", `${provider} isn't connected to this app`);
    }
    return {
      app: row.app,
      secret: row.secretEnc ? decryptSecret(row.secretEnc, deps.keyring) : null,
      bundleId: row.app.bundleId ?? row.pushBundle ?? null,
    };
  }

  /**
   * Records the event once (redeliveries are no-ops), points the person's devices at their new subscription
   * state, and queues their automations, all in one transaction.
   */
  async function accept(target: Receiver, n: Normalized) {
    const appId = target.app.id;
    try {
      await db.transaction(async (tx) => {
        const deviceIds = n.kind === "event" ? await matchDevices(tx, appId, n.provider, n.match) : [];
        const status: ProviderEventStatus = n.kind === "test" ? "test" : n.kind === "ignored" ? "ignored" : deviceIds.length ? "accepted" : "unmatched";
        await tx.insert(providerEvents).values({
          id: uuidv7(),
          appId,
          provider: n.provider,
          providerEventId: n.eventId,
          rawType: n.rawType,
          event: n.event,
          status,
          reason: status === "unmatched" ? "no device matches this person yet" : null,
          environment: n.environment,
          person: n.person,
          productId: n.productId,
          deviceIds,
        });
        await tx
          .update(providerIntegrations)
          .set({ lastEventAt: new Date() })
          .where(and(eq(providerIntegrations.appId, appId), eq(providerIntegrations.provider, n.provider)));
        if (!n.event || deviceIds.length === 0) return;
        const subscription: DeviceSubscription = {
          status: SUBSCRIPTION_STATUS[n.event],
          paying: PAYING_AFTER[n.event],
          provider: n.provider,
          productId: n.productId,
          expiresAt: n.expiresAt,
          updatedAt: new Date().toISOString(),
        };
        await tx.update(devices).set({ subscription }).where(inArray(devices.id, deviceIds));
        await deps.jobs.automationEvent(tx, { appId, deviceIds, event: n.event });
      });
    } catch (err) {
      if (isUniqueViolation(err, "provider_events_dedupe_uq")) return "duplicate";
      throw err;
    }
    return "ok";
  }

  /** Runs a receiver: verification failures are logged as refusals and answered 401; bad payloads 400. */
  function receive(provider: Provider, handle: (target: Receiver, raw: string, header: (name: string) => string | undefined) => Promise<Normalized | null>) {
    r.post(`/${provider}/:appId`, async (c) => {
      const target = await receiver(provider, c.req.param("appId"));
      if (!target) return c.json({ error: { code: "not_found", message: "Unknown App ID" } }, 404);
      const raw = await c.req.text();
      let n: Normalized | null;
      try {
        n = await handle(target, raw, (name) => c.req.header(name));
      } catch (err) {
        if (err instanceof SignatureRejected || err instanceof JwsRejected) {
          await log(target.app.id, provider, "refused", err.message);
          return c.json({ error: { code: "invalid_signature", message: err.message } }, 401);
        }
        if (err instanceof PayloadRejected || err instanceof SyntaxError) {
          await log(target.app.id, provider, "refused", err instanceof SyntaxError ? "not JSON" : err.message);
          return c.json({ error: { code: "validation_failed", message: err.message } }, 400);
        }
        throw err;
      }
      if (!n) return c.json({});
      if (provider === "appstore" && target.bundleId && n.bundleId && n.bundleId !== target.bundleId) {
        await log(target.app.id, provider, "refused", `wrong bundle ID (${n.bundleId})`, n);
        return c.json({ error: { code: "validation_failed", message: "This notification is for another app" } }, 400);
      }
      const outcome = await accept(target, n);
      return c.json({ ok: true, duplicate: outcome === "duplicate" });
    });
  }

  receive("revenuecat", async (target, raw, header) => {
    checkAuthorization(header("authorization"), target.secret!);
    return normalizeRevenueCat(JSON.parse(raw), raw);
  });

  receive("superwall", async (target, raw, header) => {
    const deliveryId = checkSvixSignature(header, raw, target.secret!);
    return normalizeSuperwall(JSON.parse(raw), raw, deliveryId);
  });

  receive("adapty", async (target, raw, header) => {
    const body = JSON.parse(raw) as unknown;
    // the URL check when the webhook is saved; answered even before the Authorization value is pasted
    if (isAdaptyUrlCheck(body)) return null;
    checkAuthorization(header("authorization"), target.secret!);
    return normalizeAdapty(body, raw);
  });

  receive("appstore", async (_target, raw) => normalizeAppStore(JSON.parse(raw), jwsOptions));

  return r;
}
