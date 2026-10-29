/*
 * Turns an app's resolved conversations into eval cases: what the person said up to the team's first answer,
 * with that answer as the reference. Label each case's `expect` (reply, offer, review or handover, and what the
 * answer must or mustn't say) before grading with it.
 *
 *   npm run eval:export -w @hshelby/api -- --app <app UUID> [--limit 50]
 *
 * Writes eval/cases.<app>.json, which git ignores: it holds real people's messages.
 */
import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { conversations, createDb, devices, messages } from "@hshelby/db";
import { and, asc, desc, eq } from "drizzle-orm";
import type { EvalCase } from "./cases";

const { values: args } = parseArgs({ options: { app: { type: "string" }, limit: { type: "string", default: "50" } } });
if (!args.app || !process.env.DATABASE_URL) {
  console.error("Usage: DATABASE_URL=… npm run eval:export -w @hshelby/api -- --app <app UUID> [--limit 50]");
  process.exit(2);
}

const { db, pool } = createDb(process.env.DATABASE_URL);
const resolved = await db
  .select({ conversation: conversations, device: devices })
  .from(conversations)
  .innerJoin(devices, eq(devices.id, conversations.deviceId))
  .where(and(eq(conversations.appId, args.app), eq(conversations.status, "closed")))
  .orderBy(desc(conversations.lastMessageAt))
  .limit(Number(args.limit));

const cases: EvalCase[] = [];
for (const { conversation, device } of resolved) {
  const thread = await db.select().from(messages).where(eq(messages.conversationId, conversation.id)).orderBy(asc(messages.seq));
  const answer = thread.findIndex((m) => m.sender === "agent" && (m.source === "dashboard" || m.source === "telegram"));
  if (answer <= 0 || thread[answer - 1]!.sender !== "user") continue;
  cases.push({
    name: `conversation ${conversation.id.slice(0, 8)}`,
    transcript: thread.slice(0, answer).map((m) => ({
      from: m.sender === "user" ? "person" : m.source === "ai" ? "ai" : m.source === "automation" ? "automation" : "team",
      text: m.text,
    })),
    person: {
      locale: device.locale,
      timezone: device.timezone,
      paywalls: device.availablePaywalls.filter((p) => p.presentable).map((p) => ({ id: p.id, title: p.title, products: p.products })),
      reviewAskedAt: device.reviewAskedAt?.toISOString() ?? null,
      subscription: device.subscription ? { status: device.subscription.status, productId: device.subscription.productId } : null,
    },
    reference: thread[answer]!.text,
  });
}

const file = new URL(`./cases.${args.app}.json`, import.meta.url);
writeFileSync(file, `${JSON.stringify(cases, null, 2)}\n`);
console.log(`${cases.length} cases → ${file.pathname}`);
await pool.end();
