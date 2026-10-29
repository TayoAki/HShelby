/*
 * Runs the AI replies eval against the real model and grades each answer with code checks.
 *
 *   ANTHROPIC_API_KEY=… npm run eval -w @hshelby/api [-- --bar 0.9 --only refund --cases eval/cases.<app>.json]
 *
 * OPENROUTER_API_KEY instead runs it through OpenRouter, and AI_MODEL picks another model (see src/ai/provider.ts).
 *
 * Nothing is sent to anyone: the tools only record what the model chose. Each case is one model call (two
 * when a guardrail refuses the first choice). Exits 1 when the pass rate is under the bar.
 */
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import type { AiAction, AiUsage, ReportedPaywall } from "@hshelby/contracts";
import { runTurn, type Executor } from "../src/ai/assistant";
import { aiProviderFromEnv, type AiProvider } from "../src/ai/provider";
import { offersFor, reviewUnavailable, systemPrompt, turnPrompt, type PersonFacts, type TranscriptMessage } from "../src/ai/prompt";
import { CASES, EVAL_APP, type EvalCase, type Outcome } from "./cases";

const { values: args } = parseArgs({
  options: {
    cases: { type: "string" },
    only: { type: "string" },
    bar: { type: "string", default: "0.9" },
    concurrency: { type: "string", default: "4" },
  },
});

/** Claude Opus 5.5 list prices per million tokens (the same through OpenRouter); cache writes at the 5-minute rate. */
const PRICE = { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 };
const dryRun: Executor = { reply: async () => {}, offer: async () => {}, review: async () => {}, handover: async () => {} };

const outcomeOf = (actions: AiAction[]): Outcome =>
  actions.some((a) => a.type === "handover")
    ? "handover"
    : actions.some((a) => a.type === "offer")
      ? "offer"
      : actions.some((a) => a.type === "review")
        ? "review"
        : actions.length
          ? "reply"
          : "none";

const seen = (actions: AiAction[]) =>
  actions.map((a) => (a.type === "handover" ? a.message : a.text)).filter(Boolean).join("\n");

function grade(c: EvalCase, actions: AiAction[]) {
  if (!c.expect) return null;
  const problems: string[] = [];
  const outcome = outcomeOf(actions);
  if (!c.expect.outcome.includes(outcome)) problems.push(`chose ${outcome}, expected ${c.expect.outcome.join(" or ")}`);
  const text = seen(actions);
  for (const re of c.expect.include ?? []) if (!new RegExp(re, "im").test(text)) problems.push(`missing /${re}/`);
  for (const re of c.expect.exclude ?? []) if (new RegExp(re, "im").test(text)) problems.push(`contains /${re}/`);
  const offer = actions.find((a) => a.type === "offer");
  if (offer && c.expect.offer && offer.paywallId !== c.expect.offer) problems.push(`offered ${offer.paywallId}, expected ${c.expect.offer}`);
  return problems;
}

async function runCase(ai: AiProvider, c: EvalCase) {
  const settings = {
    name: "Assistant",
    instructions: c.settings?.instructions ?? EVAL_APP.instructions,
    docs: c.settings?.docs ?? EVAL_APP.docs,
    allowOffers: c.settings?.allowOffers ?? true,
    allowReviews: c.settings?.allowReviews ?? true,
  };
  const app = { appStoreId: c.appStoreId === undefined ? EVAL_APP.appStoreId : c.appStoreId };
  const paywalls: ReportedPaywall[] = (c.person?.paywalls ?? []).map((p) => ({ ...p, source: "app", presentable: true, products: p.products ?? [] }));
  const person: PersonFacts = {
    name: c.person?.name ?? "Sam",
    email: null,
    userId: null,
    verified: false,
    locale: c.person?.locale ?? "en_US",
    timezone: c.person?.timezone ?? "America/New_York",
    model: "iPhone16,1",
    osVersion: "18.2",
    appVersion: "3.4",
    subscription: c.person?.subscription
      ? { status: c.person.subscription.status, productId: c.person.subscription.productId ?? null, provider: "revenuecat", paying: true, expiresAt: null, updatedAt: new Date().toISOString() }
      : null,
    availablePaywalls: paywalls,
    reviewAskedAt: c.person?.reviewAskedAt ? new Date(c.person.reviewAskedAt) : null,
  };
  const now = Date.now();
  const transcript: TranscriptMessage[] = c.transcript.map((m, i, all) => ({
    sender: m.from === "person" ? "user" : "agent",
    source: m.from === "person" ? "sdk" : m.from === "team" ? "dashboard" : m.from,
    authorName: m.from === "team" ? "Tayo" : null,
    text: m.text,
    kind: "text",
    card: null,
    actionClickedAt: null,
    photos: m.photos ?? 0,
    createdAt: new Date(now - (all.length - i) * 120_000),
  }));
  const started = Date.now();
  const result = await runTurn(
    ai,
    {
      system: systemPrompt(EVAL_APP.name, settings),
      prompt: turnPrompt(app, settings, person, transcript),
      allowOffers: settings.allowOffers,
      allowReviews: settings.allowReviews,
      offers: offersFor(person),
      reviewUnavailable: reviewUnavailable(app, person),
    },
    dryRun,
  );
  return { ...result, latencyMs: Date.now() - started };
}

async function main() {
  const env = process.env;
  const ai = aiProviderFromEnv(
    {
      ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY,
      ANTHROPIC_BASE_URL: env.ANTHROPIC_BASE_URL,
      OPENROUTER_API_KEY: env.OPENROUTER_API_KEY,
      OPENROUTER_BASE_URL: env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api",
      AI_MODEL: env.AI_MODEL,
    },
    { maxRetries: 4 },
  );
  if (!ai) {
    console.error("Set ANTHROPIC_API_KEY or OPENROUTER_API_KEY to run the eval (it calls the real model).");
    process.exit(2);
  }
  const all: EvalCase[] = args.cases ? JSON.parse(readFileSync(args.cases, "utf8")) : CASES;
  const cases = all.filter((c) => !args.only || c.name.includes(args.only));
  console.log(`${cases.length} cases on ${ai.model} (${ai.name})\n`);

  const total: AiUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
  let passed = 0;
  let graded = 0;
  let refused = 0;
  let fallbacks = 0;
  const latencies: number[] = [];
  const queue = [...cases];
  const lines = new Map<EvalCase, string>();

  await Promise.all(
    Array.from({ length: Number(args.concurrency) }, async () => {
      for (let c = queue.shift(); c; c = queue.shift()) {
        try {
          const r = await runCase(ai, c);
          for (const k of Object.keys(total) as (keyof AiUsage)[]) total[k] += r.usage[k];
          latencies.push(r.latencyMs);
          if (r.refused) refused++;
          if (r.fallback) fallbacks++;
          const problems = grade(c, r.actions);
          const outcome = outcomeOf(r.actions);
          const said = seen(r.actions).replace(/\s+/g, " ").slice(0, 160);
          const handover = r.actions.find((a) => a.type === "handover");
          const detail = [said && `“${said}”`, handover?.type === "handover" && `[handover: ${handover.reason}]`, ...r.notes.map((n) => `[refused ${n}]`)]
            .filter(Boolean)
            .join(" ");
          if (problems === null) {
            lines.set(c, `•  ${c.name} — ${outcome} ${detail}\n     team said: “${(c.reference ?? "").replace(/\s+/g, " ").slice(0, 160)}”`);
          } else {
            graded++;
            if (problems.length === 0) passed++;
            lines.set(c, `${problems.length ? "✗" : "✓"}  ${c.name} — ${outcome} ${detail}${problems.length ? `\n     ${problems.join("; ")}` : ""}`);
          }
        } catch (err) {
          graded++;
          lines.set(c, `✗  ${c.name} — error: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }),
  );

  for (const c of cases) console.log(lines.get(c));
  const cost =
    (total.inputTokens * PRICE.input + total.outputTokens * PRICE.output + total.cacheReadTokens * PRICE.cacheRead + total.cacheWriteTokens * PRICE.cacheWrite) / 1e6;
  latencies.sort((a, b) => a - b);
  const p50 = latencies[Math.floor(latencies.length / 2)] ?? 0;
  const rate = graded ? passed / graded : 1;
  console.log(
    `\n${passed}/${graded} passed (${Math.round(rate * 100)}%), bar ${Math.round(Number(args.bar) * 100)}%` +
      `${graded < cases.length ? `, ${cases.length - graded} unlabelled` : ""}; ${refused} refused, ${fallbacks} answered by the fallback model`,
  );
  console.log(
    `tokens: ${total.inputTokens} in, ${total.outputTokens} out, ${total.cacheReadTokens} cache read, ${total.cacheWriteTokens} cache write ≈ $${cost.toFixed(2)}; median ${(p50 / 1000).toFixed(1)} s per case`,
  );
  process.exit(rate >= Number(args.bar) ? 0 : 1);
}

await main();
