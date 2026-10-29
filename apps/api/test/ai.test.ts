/* eslint-disable @typescript-eslint/no-explicit-any -- response bodies are asserted on, not typed */
import Anthropic from "@anthropic-ai/sdk";
import { aiRuns, apps, auditEvents, conversations, devices } from "@hshelby/db";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { runTurn, type Executor } from "../src/ai/assistant";
import { considerMessage } from "../src/ai/consider";
import { aiProvider, aiProviderFromEnv } from "../src/ai/provider";
import { AI_CONSIDER_QUEUE, type AiConsiderJob } from "../src/jobs";
import { lastToolResults, refusal, say, startFakeAnthropic, toolUse } from "./fake-anthropic";
import { joinAsMember, makeTestApp, registerDevice, reply, workspaceWithApp } from "./helpers";

const fake = await startFakeAnthropic();
const { app, deps, close } = await makeTestApp({ ai: aiProvider("anthropic", new Anthropic({ apiKey: "test-key", baseURL: fake.url, maxRetries: 0 })) });
afterAll(async () => {
  await close();
  await fake.close();
});

type Team = Awaited<ReturnType<typeof workspaceWithApp>>;
type Device = Awaited<ReturnType<typeof registerDevice>>;

const DOCS = "LockdList blocks distracting apps. To set up a block: Settings → Blocks → New block. Plans: Pro yearly.";
const PRO = { id: "pro-yearly", title: "Pro yearly 50% off", source: "revenuecat", products: [{ id: "pro.yearly", price: "$29.99", period: "P1Y" }] };

const enable = async (team: Team, settings: Record<string, unknown> = {}) => {
  const res = await team.call(`/api/apps/${team.appId}/ai`, {
    method: "PUT",
    body: JSON.stringify({ enabled: true, name: "Assistant", instructions: "Be brief.", docs: DOCS, allowOffers: true, allowReviews: true, ...settings }),
  });
  expect(res.status).toBe(200);
  return ((await res.json()) as any).settings;
};

/** The person writes; returns the job their message is answered by. */
async function write(device: Device, text: string): Promise<AiConsiderJob> {
  const res = await device.send(text);
  expect(res.status).toBe(201);
  const body = (await res.json()) as any;
  return { conversationId: body.conversation.id, messageId: body.message.id };
}

/** The ai.consider jobs waiting for a person's message, with how far ahead each is due (ms). */
async function queued(job: AiConsiderJob) {
  const rows = await deps.db.execute<{ data: AiConsiderJob; due_in: number }>(
    sql`select data, (extract(epoch from start_after - now()) * 1000)::int as due_in from pgboss.job
        where name = ${AI_CONSIDER_QUEUE} and data->>'messageId' = ${job.messageId} and state = 'created'`,
  );
  return rows.rows;
}

const consider = (job: AiConsiderJob) => considerMessage(deps, job);
const sync = async (device: Device) => ((await (await device.sdk("/v1/conversation")).json()) as any).messages as any[];
const conversation = async (team: Team, id: string) => ((await (await team.call(`/api/conversations/${id}`)).json()) as any).conversation;
const runs = async (team: Team) => ((await (await team.call(`/api/apps/${team.appId}/ai/runs`)).json()) as any).runs as any[];

/** A workspace with AI replies on, and a person whose app reported `paywalls`. */
async function setup(settings: Record<string, unknown> = {}, paywalls: unknown[] = [PRO]) {
  const team = await workspaceWithApp(app);
  await enable(team, settings);
  const device = await registerDevice(app, team.publicId, { paywalls, identity: { name: "Alex" } });
  return { team, device };
}

describe("settings", () => {
  it("start off, need a model key to turn on, and only admins change them", async () => {
    const team = await workspaceWithApp(app);
    const overview = (await (await team.call(`/api/apps/${team.appId}/ai`)).json()) as any;
    expect(overview).toMatchObject({ available: true, model: "claude-opus-5-5", settings: { enabled: false, name: "Assistant", docs: "" } });

    const device = await registerDevice(app, team.publicId);
    const job = await write(device, "Hi");
    expect((await conversation(team, job.conversationId)).ai).toBeNull();
    // off: the person's messages schedule nothing
    expect(await queued(job)).toHaveLength(0);

    const member = await joinAsMember(app, deps, team.call);
    expect((await member.call(`/api/apps/${team.appId}/ai`, { method: "PUT", body: JSON.stringify({ ...overview.settings, enabled: true, updatedAt: undefined }) })).status).toBe(403);
    await enable(team);
    expect((await conversation(team, job.conversationId)).ai).toMatchObject({ state: "active", reason: null });
    const audit = await deps.db.select().from(auditEvents).where(eq(auditEvents.target, team.appId));
    expect(audit.map((a) => a.action).sort()).toEqual(["app.ai.enabled", "app.ai.knowledge_changed"]);

    const keyless = await makeTestApp();
    const other = await workspaceWithApp(keyless.app);
    const res = await other.call(`/api/apps/${other.appId}/ai`, { method: "PUT", body: JSON.stringify({ enabled: true, name: "A", instructions: "", docs: "", allowOffers: true, allowReviews: true }) });
    expect(res.status).toBe(409);
    expect(((await res.json()) as any).error.code).toBe("ai_unavailable");
    await keyless.close();
  });
});

describe("answering", () => {
  it("answers after the debounce with cached docs, strict tools and server-side fallbacks", async () => {
    const { team, device } = await setup();
    await deps.db.update(apps).set({ showTeamNames: true }).where(eq(apps.id, team.appId));
    const job = await write(device, "How do I block Instagram?");
    const [pending] = await queued(job);
    expect(pending!.data).toEqual(job);
    expect(pending!.due_in).toBeGreaterThan(6000);
    expect(pending!.due_in).toBeLessThanOrEqual(8000);

    const before = fake.requests.length;
    fake.respond(() => toolUse("reply", { text: "Open Settings → Blocks → New block, then pick Instagram." }));
    expect(await consider(job)).toBe("replied");
    // the turn ends once it's answered: no closing call to the model
    expect(fake.requests.length - before).toBe(1);

    const [request] = fake.requests.slice(before);
    const body = request!.body;
    expect(body).toMatchObject({ model: "claude-opus-5-5", fallbacks: "default", output_config: { effort: "low" }, max_tokens: 16000 });
    expect(request!.headers["anthropic-beta"]).toContain("server-side-fallback-2026-07-01");
    expect(body.tool_choice?.type ?? "auto").toBe("auto");
    expect(body.thinking?.type ?? "adaptive").toBe("adaptive");
    expect(body.tools.map((t: any) => [t.name, t.strict, t.input_schema.additionalProperties])).toEqual([
      ["reply", true, false],
      ["send_offer", true, false],
      ["ask_review", true, false],
      ["handover", true, false],
    ]);
    const system = body.system as any[];
    expect(system.at(-1)).toMatchObject({ cache_control: { type: "ephemeral" } });
    expect(system.map((b) => b.text).join("\n")).toContain(DOCS);
    expect(system.map((b) => b.text).join("\n")).toContain("Be brief.");
    const prompt = body.messages[0].content as string;
    expect(prompt).toContain("Person: How do I block Instagram?");
    expect(prompt).toContain("pro-yearly: Pro yearly 50% off");
    expect(prompt).toContain("Rating request: not available (the app has no App Store ID)");

    const messages = await sync(device);
    expect(messages.at(-1)).toMatchObject({ sender: "agent", text: "Open Settings → Blocks → New block, then pick Instagram.", byAi: true, author: { name: "Assistant" } });
    // the AI's answer doesn't mark the conversation read for the team
    expect((await conversation(team, job.conversationId)).unreadForTeam).toBe(1);
    const [run] = await runs(team);
    expect(run).toMatchObject({ outcome: "replied", person: "Alex", fallback: false, usage: { inputTokens: 900, outputTokens: 120, cacheReadTokens: 3000 } });
    const inbox = (await (await team.call(`/api/conversations/${job.conversationId}/messages`)).json()) as any;
    expect(inbox.messages.at(-1)).toMatchObject({ source: "ai", author: null });
  });

  it("gives a burst of messages one answer, to the last of them", async () => {
    const { device } = await setup();
    const jobs = [await write(device, "hey"), await write(device, "the blocker isn't working"), await write(device, "since the update")];
    fake.respond(() => toolUse("reply", { text: "Sorry about that! Which iOS version are you on?" }));
    const before = fake.requests.length;
    expect(await consider(jobs[0]!)).toBe("superseded");
    expect(await consider(jobs[1]!)).toBe("superseded");
    expect(await consider(jobs[2]!)).toBe("replied");
    expect(fake.requests.length - before).toBe(1);
    const prompt = fake.requests.at(-1)!.body.messages[0].content as string;
    expect(prompt).toMatch(/Person: hey[\s\S]*Person: the blocker isn't working[\s\S]*Person: since the update/);
    // a retried job finds its message answered
    expect(await consider(jobs[2]!)).toBe("answered");
    expect((await sync(device)).filter((m) => m.sender === "agent")).toHaveLength(1);
  });

  it("pauses when a teammate replies, and answers what's waiting when handed back", async () => {
    const { team, device } = await setup();
    const job = await write(device, "Can I get a discount?");
    expect((await reply(team.call, job.conversationId, "Let me check for you")).status).toBe(201);
    const before = fake.requests.length;
    expect(await consider(job)).toBe("paused");
    expect(fake.requests.length).toBe(before);
    expect((await conversation(team, job.conversationId)).ai).toMatchObject({ state: "paused" });

    // the person's next message stays with the teammate
    const next = await write(device, "ok thanks");
    expect(await queued(next)).toHaveLength(0);

    const res = await team.call(`/api/conversations/${job.conversationId}/ai`, { method: "POST", body: JSON.stringify({ state: "active" }) });
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).conversation.ai).toMatchObject({ state: "active" });
    const [handedBack] = await queued(next);
    expect(handedBack!.data).toEqual(next);
    expect(handedBack!.due_in).toBeLessThanOrEqual(0);
    fake.respond(() => toolUse("reply", { text: "You're welcome!" }));
    expect(await consider(next)).toBe("replied");

    // resolving ends a pause
    await team.call(`/api/conversations/${job.conversationId}/ai`, { method: "POST", body: JSON.stringify({ state: "paused" }) });
    expect((await conversation(team, job.conversationId)).ai.state).toBe("paused");
    await team.call(`/api/conversations/${job.conversationId}/resolve`, { method: "POST" });
    expect((await conversation(team, job.conversationId)).ai.state).toBe("active");
  });

  it("never double-replies: a teammate answering while the AI thinks wins", async () => {
    const { team, device } = await setup();
    const job = await write(device, "My subscription disappeared");
    fake.respond(async () => {
      expect((await reply(team.call, job.conversationId, "Looking into it now")).status).toBe(201);
      return toolUse("reply", { text: "Try Restore Purchases in Settings." });
    });
    expect(await consider(job)).toBe("stopped");
    expect((await sync(device)).map((m) => [m.sender, m.text, m.byAi])).toEqual([
      ["user", "My subscription disappeared", false],
      ["agent", "Looking into it now", false],
    ]);
    expect((await runs(team))[0]).toMatchObject({ outcome: "stopped", actions: [] });
  });

  it("stops when the person writes again mid-turn; their new message gets the answer", async () => {
    const { device } = await setup();
    const job = await write(device, "hello?");
    let next: AiConsiderJob | null = null;
    fake.respond(async () => {
      next ??= await write(device, "how do I cancel");
      return toolUse("reply", { text: "Hi! How can I help?" });
    });
    expect(await consider(job)).toBe("stopped");
    expect((await sync(device)).filter((m) => m.sender === "agent")).toHaveLength(0);
    fake.respond(() => toolUse("reply", { text: "Settings → Apple ID → Subscriptions → LockdList → Cancel." }));
    expect(await consider(next!)).toBe("replied");
  });
});

describe("guardrails", () => {
  it("only offers paywalls the device reported; the model is told and tries again", async () => {
    const { team, device } = await setup();
    const job = await write(device, "Is there a cheaper plan?");
    fake.respond((body) => {
      const [result] = lastToolResults(body);
      if (!result) return toolUse("send_offer", { paywall_id: "lifetime-90-off", text: "Here's 90% off lifetime!" });
      expect(result).toMatchObject({ name: "send_offer", isError: true });
      expect(result.content).toContain("Available: pro-yearly");
      return toolUse("send_offer", { paywall_id: "pro-yearly", text: "Yearly is half price right now." });
    });
    expect(await consider(job)).toBe("sent_offer");
    expect((await sync(device)).at(-1)).toMatchObject({ kind: "paywall", text: "Yearly is half price right now.", card: { type: "paywall", paywallId: "pro-yearly" }, byAi: true });
    const [run] = await runs(team);
    expect(run.notes).toEqual(["send_offer: lifetime-90-off isn't available on their device"]);
    expect(run.actions).toEqual([{ type: "offer", paywallId: "pro-yearly", text: "Yearly is half price right now." }]);
  });

  it("can't promise refunds, and hands over with a note to the team", async () => {
    const { team, device } = await setup();
    const job = await write(device, "I want my money back");
    fake.respond((body) => {
      const [result] = lastToolResults(body);
      if (!result) return toolUse("reply", { text: "No problem, I've refunded your purchase." });
      expect(result.content).toContain("reportaproblem.apple.com");
      return toolUse(
        "reply",
        { text: "Apple handles App Store refunds at reportaproblem.apple.com." },
        ["handover", { reason: "Wants a refund; pointed them to Apple", message: "" }],
      );
    });
    expect(await consider(job)).toBe("handed_over");
    expect((await conversation(team, job.conversationId)).ai).toMatchObject({ state: "handed_over", reason: "Wants a refund; pointed them to Apple" });
    expect((await sync(device)).filter((m) => m.sender === "agent").map((m) => m.text)).toEqual(["Apple handles App Store refunds at reportaproblem.apple.com."]);
    // Telegram hears about it, out loud
    const notify = await deps.db.execute<{ data: any }>(sql`select data from pgboss.job where name = 'team.notify' and data->>'messageId' = ${job.messageId} and data ? 'handover'`);
    expect(notify.rows.map((r) => r.data)).toEqual([{ messageId: job.messageId, handover: "Wants a refund; pointed them to Apple" }]);
    expect((await runs(team))[0].notes).toEqual([expect.stringMatching(/^reply: You can't promise or issue refunds/)]);
    // handed over: the person's next message waits for a teammate
    expect(await queued(await write(device, "hello?"))).toHaveLength(0);
  });

  it("asks for a rating only with an App Store ID, and not again soon after", async () => {
    const { team, device } = await setup();
    fake.respond((body) => (lastToolResults(body).length ? toolUse("reply", { text: "Glad it works!" }) : toolUse("ask_review", { text: "Would you rate us?" })));
    expect(await consider(await write(device, "it works now, thanks!"))).toBe("replied");
    expect((await runs(team))[0].notes).toEqual(["ask_review: not available (the app has no App Store ID)"]);

    await deps.db.update(apps).set({ appStoreId: "6700000001" }).where(eq(apps.id, team.appId));
    expect(await consider(await write(device, "really great app"))).toBe("asked_review");
    expect((await sync(device)).at(-1)).toMatchObject({ kind: "review", card: { type: "review", url: "https://apps.apple.com/app/id6700000001?action=write-review" } });
    const [row] = await deps.db.select({ reviewAskedAt: devices.reviewAskedAt }).from(devices).innerJoin(conversations, eq(conversations.deviceId, devices.id)).where(eq(devices.appId, team.appId));
    expect(row!.reviewAskedAt).not.toBeNull();

    expect(await consider(await write(device, "rated it!"))).toBe("replied");
    expect((await runs(team))[0].notes[0]).toMatch(/^ask_review: not available \(they were asked on \d{4}-\d\d-\d\d\)$/);
  });

  it("leaves out the tools an app turned off", async () => {
    const { device } = await setup({ allowOffers: false, allowReviews: false });
    fake.respond(() => toolUse("reply", { text: "Sure!" }));
    await consider(await write(device, "hi"));
    const body = fake.requests.at(-1)!.body;
    expect(body.tools.map((t: any) => t.name)).toEqual(["reply", "handover"]);
    expect(body.messages[0].content).not.toContain("Offers you can send");
    expect(body.system[0].text).not.toContain("send_offer");
  });

  it("sends one message per turn", async () => {
    const { device } = await setup();
    fake.respond(() => toolUse("reply", { text: "First" }, ["reply", { text: "Second" }]));
    expect(await consider(await write(device, "hi"))).toBe("replied");
    expect((await sync(device)).filter((m) => m.sender === "agent").map((m) => m.text)).toEqual(["First"]);
  });
});

describe("when the model can't answer", () => {
  it("hands over on a refusal, and records a fallback that answered", async () => {
    const { team, device } = await setup();
    const job = await write(device, "…");
    fake.respond(() => refusal());
    expect(await consider(job)).toBe("handed_over");
    expect((await conversation(team, job.conversationId)).ai).toMatchObject({ state: "handed_over", reason: "The AI declined to answer this one." });
    expect((await sync(device)).filter((m) => m.sender === "agent")).toHaveLength(0);

    const other = await setup();
    fake.respond(() => ({ ...toolUse("reply", { text: "Happy to help." }), fallback: true }));
    expect(await consider(await write(other.device, "hi"))).toBe("replied");
    expect((await runs(other.team))[0]).toMatchObject({ outcome: "replied", fallback: true });
  });

  it("hands over when the model service fails or no tool is chosen", async () => {
    const { team, device } = await setup();
    const job = await write(device, "help");
    fake.fail(500);
    try {
      expect(await consider(job)).toBe("failed");
    } finally {
      fake.fail(null);
    }
    expect((await conversation(team, job.conversationId)).ai.state).toBe("handed_over");
    expect((await runs(team))[0]).toMatchObject({ outcome: "failed", error: expect.stringMatching(/^500/) });

    const other = await setup();
    fake.respond(() => say("Hmm, let me think about that."));
    expect(await consider(await write(other.device, "help"))).toBe("handed_over");
    expect((await sync(other.device)).filter((m) => m.sender === "agent")).toHaveLength(0);
  });
});

describe("preview", () => {
  it("shows what the AI would do with unsaved settings, sending nothing", async () => {
    const team = await workspaceWithApp(app);
    const device = await registerDevice(app, team.publicId, { paywalls: [PRO] });
    await write(device, "hello");
    fake.respond((body) => {
      expect(body.system.map((b: any) => b.text).join("\n")).toContain("Unsaved docs");
      return toolUse("send_offer", { paywall_id: "pro-yearly", text: "Half price!" });
    });
    const res = await team.call(`/api/apps/${team.appId}/ai/preview`, {
      method: "POST",
      body: JSON.stringify({
        settings: { name: "Shelby", instructions: "", docs: "Unsaved docs", allowOffers: true, allowReviews: true },
        messages: [{ sender: "user", text: "How much is Pro?" }],
      }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ actions: [{ type: "offer", paywallId: "pro-yearly", text: "Half price!" }], refused: false, notes: [] });
    // nothing was sent or recorded
    expect((await sync(device)).filter((m) => m.sender === "agent")).toHaveLength(0);
    expect(await deps.db.select().from(aiRuns).where(and(eq(aiRuns.appId, team.appId)))).toHaveLength(0);

    const member = await joinAsMember(app, deps, team.call);
    expect((await member.call(`/api/apps/${team.appId}/ai/preview`, { method: "POST", body: JSON.stringify({ messages: [{ sender: "user", text: "hi" }] }) })).status).toBe(403);
  });
});

describe("through OpenRouter", () => {
  it("takes the Anthropic key first, then OpenRouter's, and AI_MODEL overrides the model", () => {
    const base = { ANTHROPIC_BASE_URL: undefined, OPENROUTER_BASE_URL: "https://openrouter.ai/api", AI_MODEL: undefined };
    expect(aiProviderFromEnv({ ...base, ANTHROPIC_API_KEY: undefined, OPENROUTER_API_KEY: undefined })).toBeNull();
    expect(aiProviderFromEnv({ ...base, ANTHROPIC_API_KEY: "sk-ant", OPENROUTER_API_KEY: "sk-or" })).toMatchObject({ name: "anthropic", model: "claude-opus-5-5", serverFallback: true });
    expect(aiProviderFromEnv({ ...base, ANTHROPIC_API_KEY: undefined, OPENROUTER_API_KEY: "sk-or" })).toMatchObject({ name: "openrouter", model: "anthropic/claude-opus-5.5", serverFallback: false });
    expect(aiProviderFromEnv({ ...base, ANTHROPIC_API_KEY: undefined, OPENROUTER_API_KEY: "sk-or", AI_MODEL: "anthropic/claude-sonnet-5.5" })?.model).toBe("anthropic/claude-sonnet-5.5");
  });

  it("sends the key as a bearer token, names OpenRouter's model and leaves out the server-side fallback", async () => {
    const ai = aiProviderFromEnv({
      ANTHROPIC_API_KEY: undefined,
      ANTHROPIC_BASE_URL: undefined,
      OPENROUTER_API_KEY: "sk-or-test",
      OPENROUTER_BASE_URL: fake.url,
      AI_MODEL: undefined,
    })!;
    const sent: string[] = [];
    const executor: Executor = { reply: async (text) => void sent.push(text), offer: async () => {}, review: async () => {}, handover: async () => {} };
    const before = fake.requests.length;
    fake.respond(() => toolUse("reply", { text: "Settings → Restore purchases." }));
    const result = await runTurn(
      ai,
      { system: [{ type: "text", text: "You answer support chats." }], prompt: "How do I restore?", allowOffers: false, allowReviews: false, offers: [], reviewUnavailable: "off" },
      executor,
    );
    expect(sent).toEqual(["Settings → Restore purchases."]);
    expect(result).toMatchObject({ refused: false, fallback: false, actions: [{ type: "reply" }] });

    const [request] = fake.requests.slice(before);
    expect(request!.headers.authorization).toBe("Bearer sk-or-test");
    expect(request!.headers["x-api-key"]).toBeUndefined();
    expect(String(request!.headers["anthropic-beta"] ?? "")).not.toContain("server-side-fallback");
    expect(request!.body).toMatchObject({ model: "anthropic/claude-opus-5.5", output_config: { effort: "low" } });
    expect(request!.body.fallbacks).toBeUndefined();
    expect(request!.body.tools.map((t: any) => [t.name, t.strict])).toEqual([
      ["reply", true],
      ["handover", true],
    ]);
  });
});
