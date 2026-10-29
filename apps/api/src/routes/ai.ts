import Anthropic from "@anthropic-ai/sdk";
import {
  AiPreviewInput,
  AiSettingsInput,
  customerLabel,
  type AiOverview,
  type AiPreview,
  type AiRun,
  type ReportedPaywall,
} from "@hshelby/contracts";
import { uuidv7 } from "@hshelby/core";
import { aiRuns, aiSettings, appPaywalls, auditEvents, conversations, devices } from "@hshelby/db";
import { and, count, desc, eq, gte, sql, sum } from "drizzle-orm";
import { Hono } from "hono";
import { AI_MODEL, runTurn, type Executor } from "../ai/assistant";
import { getAiSettings, personFacts, transcriptOf } from "../ai/consider";
import { offersFor, reviewUnavailable, systemPrompt, turnPrompt, type PersonFacts, type TranscriptMessage } from "../ai/prompt";
import type { AppEnv, Deps } from "../context";
import { ApiError, notFound } from "../errors";
import { requireOrgAdmin } from "../middleware";
import { parseJson } from "../validation";
import { findOrgApp } from "./apps";

const unavailable = () => new ApiError(409, "ai_unavailable", "AI replies need an Anthropic API key on the server (ANTHROPIC_API_KEY)");

/** Records what the model chose without sending anything. */
const dryRun: Executor = { reply: async () => {}, offer: async () => {}, review: async () => {}, handover: async () => {} };

/** An app's AI replies under /api/apps/:id/ai. Members read; admins change settings and try them out. */
export function aiRoutes(deps: Deps) {
  const { db } = deps;
  const r = new Hono<AppEnv>();

  r.get("/:id/ai", async (c) => {
    const app = await findOrgApp(db, c.get("org").id, c.req.param("id"));
    const settings = await getAiSettings(db, app.id);
    const since = sql`now() - interval '30 days'`;
    const [totals] = await db
      .select({
        runs: count(),
        replied: sql<number>`count(*) filter (where ${aiRuns.outcome} in ('replied', 'sent_offer', 'asked_review'))`.mapWith(Number),
        handedOver: sql<number>`count(*) filter (where ${aiRuns.outcome} = 'handed_over')`.mapWith(Number),
        failed: sql<number>`count(*) filter (where ${aiRuns.outcome} = 'failed')`.mapWith(Number),
        inputTokens: sum(aiRuns.inputTokens).mapWith(Number),
        outputTokens: sum(aiRuns.outputTokens).mapWith(Number),
        cacheReadTokens: sum(aiRuns.cacheReadTokens).mapWith(Number),
        cacheWriteTokens: sum(aiRuns.cacheWriteTokens).mapWith(Number),
      })
      .from(aiRuns)
      .where(and(eq(aiRuns.appId, app.id), gte(aiRuns.createdAt, since)));
    const t = totals!;
    const overview: AiOverview = {
      settings,
      available: Boolean(deps.anthropic),
      model: AI_MODEL,
      last30Days: {
        runs: t.runs,
        replied: t.replied,
        handedOver: t.handedOver,
        failed: t.failed,
        usage: { inputTokens: t.inputTokens || 0, outputTokens: t.outputTokens || 0, cacheReadTokens: t.cacheReadTokens || 0, cacheWriteTokens: t.cacheWriteTokens || 0 },
      },
    };
    return c.json(overview);
  });

  /** Turning AI replies on or off is audited; so is a change to what the AI reads. */
  r.put("/:id/ai", requireOrgAdmin, async (c) => {
    const input = await parseJson(c, AiSettingsInput);
    const org = c.get("org");
    const app = await findOrgApp(db, org.id, c.req.param("id"));
    if (input.enabled && !deps.anthropic) throw unavailable();
    const before = await getAiSettings(db, app.id);
    const values = { ...input, updatedAt: new Date(), updatedBy: c.get("user").id };
    await db.transaction(async (tx) => {
      await tx.insert(aiSettings).values({ appId: app.id, ...values }).onConflictDoUpdate({ target: aiSettings.appId, set: values });
      const audit = (action: string) => tx.insert(auditEvents).values({ id: uuidv7(), organizationId: org.id, userId: c.get("user").id, action, target: app.id });
      if (input.enabled !== before.enabled) await audit(input.enabled ? "app.ai.enabled" : "app.ai.disabled");
      if (input.docs !== before.docs || input.instructions !== before.instructions) await audit("app.ai.knowledge_changed");
    });
    return c.json({ settings: await getAiSettings(db, app.id) });
  });

  /**
   * What the AI would do with a made-up exchange or a real conversation, without sending anything. Uses the
   * unsaved settings when given. Costs a model call, so it's for admins.
   */
  r.post("/:id/ai/preview", requireOrgAdmin, async (c) => {
    const input = await parseJson(c, AiPreviewInput);
    const app = await findOrgApp(db, c.get("org").id, c.req.param("id"));
    if (!deps.anthropic) throw unavailable();
    const settings = input.settings ?? (await getAiSettings(db, app.id));

    let person: PersonFacts;
    let transcript: TranscriptMessage[];
    if (input.conversationId) {
      const [row] = await db
        .select({ conversation: conversations, device: devices })
        .from(conversations)
        .innerJoin(devices, eq(devices.id, conversations.deviceId))
        .where(and(eq(conversations.id, input.conversationId), eq(conversations.appId, app.id)));
      if (!row) throw notFound("Conversation");
      person = personFacts(row.device);
      transcript = await transcriptOf(db, row.conversation.id);
    } else {
      // someone with every paywall the app has reported, who was never asked for a rating
      const reported = await db.select().from(appPaywalls).where(eq(appPaywalls.appId, app.id));
      const paywalls: ReportedPaywall[] = reported.map((p) => ({ id: p.paywallId, title: p.title, source: p.source, presentable: p.presentable, products: p.products }));
      person = {
        name: "Test person",
        email: null,
        userId: null,
        verified: false,
        locale: null,
        timezone: null,
        model: null,
        osVersion: null,
        appVersion: null,
        subscription: null,
        availablePaywalls: paywalls,
        reviewAskedAt: null,
      };
      const now = Date.now();
      transcript = input.messages!.map((m, i, all) => ({
        sender: m.sender,
        source: m.sender === "user" ? "sdk" : "dashboard",
        authorName: m.sender === "agent" ? c.get("user").name : null,
        text: m.text,
        kind: "text",
        card: null,
        actionClickedAt: null,
        photos: 0,
        createdAt: new Date(now - (all.length - i) * 60_000),
      }));
    }

    const started = Date.now();
    try {
      const result = await runTurn(
        deps.anthropic,
        {
          system: systemPrompt(app.name, settings),
          prompt: turnPrompt(app, settings, person, transcript),
          allowOffers: settings.allowOffers,
          allowReviews: settings.allowReviews,
          offers: offersFor(person),
          reviewUnavailable: reviewUnavailable(app, person),
        },
        dryRun,
      );
      const preview: AiPreview = {
        actions: result.actions,
        notes: result.notes,
        refused: result.refused,
        fallback: result.fallback,
        usage: result.usage,
        latencyMs: Date.now() - started,
      };
      return c.json(preview);
    } catch (err) {
      if (err instanceof Anthropic.APIError) throw new ApiError(502, "ai_unavailable", `The model service failed (${err.status ?? "connection"})`);
      throw err;
    }
  });

  r.get("/:id/ai/runs", async (c) => {
    const app = await findOrgApp(db, c.get("org").id, c.req.param("id"));
    const rows = await db
      .select({ run: aiRuns, device: devices })
      .from(aiRuns)
      .innerJoin(conversations, eq(conversations.id, aiRuns.conversationId))
      .innerJoin(devices, eq(devices.id, conversations.deviceId))
      .where(eq(aiRuns.appId, app.id))
      .orderBy(desc(aiRuns.createdAt))
      .limit(50);
    const runs: AiRun[] = rows.map(({ run, device }) => ({
      id: run.id,
      conversationId: run.conversationId,
      person: customerLabel({ ...device, userId: device.userIdExt }),
      outcome: run.outcome,
      actions: run.actions,
      notes: run.notes,
      error: run.error,
      fallback: run.fallback,
      usage: { inputTokens: run.inputTokens, outputTokens: run.outputTokens, cacheReadTokens: run.cacheReadTokens, cacheWriteTokens: run.cacheWriteTokens },
      latencyMs: run.latencyMs,
      createdAt: run.createdAt.toISOString(),
    }));
    return c.json({ runs });
  });

  return r;
}
