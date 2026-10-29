import type Anthropic from "@anthropic-ai/sdk";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { CARD_TEXT_MAX, MESSAGE_MAX_LENGTH, type AiAction, type AiUsage, type ReportedPaywall } from "@hshelby/contracts";
import { z } from "zod";
import type { AiProvider } from "./provider";

/*
 * One AI turn: the model reads the conversation and answers through its tools. Guardrails live in the tools'
 * code, not in the prompt: an offer must name a paywall the device can show, a rating request must be
 * available, nothing may promise a refund, and a turn sends at most one message. Whatever the model asks for
 * goes through an Executor, which sends for real (the ai.consider job) or only records (the preview).
 */

/** Server-side fallback: when the model declines, Anthropic's recommended substitute answers in the same call. */
const FALLBACK_BETA = "server-side-fallback-2026-07-01";
const MAX_TOKENS = 16_000;
/** Model calls per turn: room to retry after a refused action, not to wander. */
const MAX_ITERATIONS = 4;
const HANDOVER_MESSAGE_MAX = 500;
const REASON_MAX = 300;

/** A guardrail said no: the model is told `message` and may choose something else; the run records `note`. */
export class Refused extends Error {
  constructor(
    message: string,
    readonly note = message,
  ) {
    super(message);
  }
}
/** The conversation moved on (the person wrote again, a teammate replied): the turn ends and sends nothing more. */
export class Halted extends Error {}

export type Executor = {
  reply(text: string): Promise<void>;
  offer(paywall: ReportedPaywall, text: string): Promise<void>;
  review(text: string): Promise<void>;
  handover(reason: string, message: string): Promise<void>;
};

export type TurnInput = {
  system: Anthropic.Beta.BetaTextBlockParam[];
  prompt: string;
  allowOffers: boolean;
  allowReviews: boolean;
  /** The paywalls send_offer accepts: the ones the person's device reported it can show. */
  offers: ReportedPaywall[];
  /** Why ask_review is refused for this person, or null. */
  reviewUnavailable: string | null;
};

export type TurnResult = {
  actions: AiAction[];
  notes: string[];
  /** The model (and its fallback) declined to answer. */
  refused: boolean;
  /** Another model answered after Claude declined (server-side fallback, Anthropic only). */
  fallback: boolean;
  /** Why the turn stopped early, if the conversation moved on. */
  halted: string | null;
  usage: AiUsage;
};

/**
 * Promises of a refund in English. A backstop for the prompt's rule, not a classifier: it catches the
 * phrasings that matter ("I've refunded you", "we'll issue a refund", "your refund has been processed").
 */
const REFUND_PROMISE = [
  /\b(i|we)\s*('ve|have|'ll|will|am going to|are going to|can|could)\s+(go ahead and\s+)?(issue|process|give|send|arrange|approve|get)\w*\b[^.?!\n]{0,40}\brefund/i,
  /\b(i|we)\s*('ve|have|'ll|will)\s+(fully\s+)?refund(ed)?\b/i,
  /\brefund\s+(has been|was|is being|will be)\s+(issued|processed|approved|sent)\b/i,
  /\byou('ll| will)\s+(get|receive)\s+(a|your|the)\s+(full\s+)?refund\b/i,
];

export function promisesRefund(text: string) {
  return REFUND_PROMISE.some((re) => re.test(text));
}

function checkText(text: string, max: number, what: string) {
  const trimmed = text.trim();
  if (!trimmed) throw new Refused(`The ${what} is empty.`);
  if (Array.from(trimmed).length > max) throw new Refused(`The ${what} is too long; keep it under ${max} characters.`);
  if (promisesRefund(trimmed)) {
    throw new Refused(
      "You can't promise or issue refunds. Say that Apple handles App Store refunds at reportaproblem.apple.com, or hand over to the team.",
    );
  }
  return trimmed;
}

const addUsage = (total: AiUsage, u: Anthropic.Beta.BetaUsage) => {
  total.inputTokens += u.input_tokens;
  total.outputTokens += u.output_tokens;
  total.cacheReadTokens += u.cache_read_input_tokens ?? 0;
  total.cacheWriteTokens += u.cache_creation_input_tokens ?? 0;
};

export async function runTurn(ai: AiProvider, input: TurnInput, executor: Executor): Promise<TurnResult> {
  const actions: AiAction[] = [];
  const notes: string[] = [];
  const usage: AiUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
  let sent = false;
  let handedOver = false;
  let halted: string | null = null;
  /** A failure that isn't the model's to handle (the database…): the runner would hand it to the model, so it's kept here. */
  let fatal: unknown = null;
  // the runner runs one response's tool calls in parallel; a turn's actions go one at a time
  let queue = Promise.resolve();

  const act = (action: AiAction, perform: () => Promise<void>) => {
    const run = queue.then(async (): Promise<string> => {
      if (halted || fatal) return "Stopped: nothing more is sent this turn.";
      if (handedOver) throw new Error("You already handed this conversation over. End your turn.");
      if (sent && action.type !== "handover") {
        throw new Error("You already sent a message this turn. Use handover if a teammate should take over; otherwise end your turn.");
      }
      try {
        await perform();
      } catch (err) {
        if (err instanceof Refused) throw err;
        if (err instanceof Halted) {
          halted = err.message;
          return `Stopped: ${err.message}`;
        }
        fatal = err;
        return "Stopped.";
      }
      actions.push(action);
      if (action.type === "handover") {
        handedOver = true;
        return "Handed over. A teammate will take it from here. End your turn.";
      }
      sent = true;
      return "Sent. End your turn, or use handover if a teammate should follow up.";
    });
    queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };

  /** Runs a tool's body; a refusal is noted for the run and told to the model as the tool's error. */
  const guarded = async (tool: string, body: () => Promise<string>) => {
    try {
      return await body();
    } catch (err) {
      if (!(err instanceof Refused)) throw err;
      notes.push(`${tool}: ${err.note}`);
      throw new Error(err.message);
    }
  };

  const tools = [
    betaZodTool({
      name: "reply",
      description: "Send the person a chat message: plain text, short, in their language.",
      strict: true,
      inputSchema: z.object({ text: z.string().describe("The message, as the person will see it.") }),
      run: ({ text }) =>
        guarded("reply", async () => {
          const body = checkText(text, MESSAGE_MAX_LENGTH, "message");
          return act({ type: "reply", text: body }, () => executor.reply(body));
        }),
    }),
    input.allowOffers &&
      betaZodTool({
        name: "send_offer",
        description:
          "Send a message with a button that opens one of the app's paywalls. Only paywall IDs listed under 'Offers you can send' work.",
        strict: true,
        inputSchema: z.object({
          paywall_id: z.string().describe("A paywall ID from the person's list of offers."),
          text: z.string().describe("The message above the button: why this offer helps them."),
        }),
        run: ({ paywall_id, text }) =>
          guarded("send_offer", async () => {
            const paywall = input.offers.find((p) => p.id === paywall_id);
            if (!paywall) {
              const listed = input.offers.map((p) => p.id).join(", ");
              throw new Refused(
                listed ? `That paywall isn't available on their device. Available: ${listed}.` : "Their device hasn't reported any paywall it can show. Don't send an offer.",
                `${paywall_id} isn't available on their device`,
              );
            }
            const body = checkText(text, CARD_TEXT_MAX, "offer message");
            return act({ type: "offer", paywallId: paywall.id, text: body }, () => executor.offer(paywall, body));
          }),
      }),
    input.allowReviews &&
      betaZodTool({
        name: "ask_review",
        description: "Send a message with a button that opens the App Store rating page. Only when a rating request is available.",
        strict: true,
        inputSchema: z.object({ text: z.string().describe("The message above the button.") }),
        run: ({ text }) =>
          guarded("ask_review", async () => {
            if (input.reviewUnavailable) {
              throw new Refused(`A rating request isn't available: ${input.reviewUnavailable}.`, `not available (${input.reviewUnavailable})`);
            }
            const body = checkText(text, CARD_TEXT_MAX, "rating message");
            return act({ type: "review", text: body }, () => executor.review(body));
          }),
      }),
    betaZodTool({
      name: "handover",
      description: "Pass the conversation to a teammate. The AI stops answering here until the team hands it back.",
      strict: true,
      inputSchema: z.object({
        reason: z.string().describe("For the team: what the person needs and why you're handing over, in English, one sentence."),
        message: z.string().describe("For the person: a short note that a teammate will follow up here, in their language. Empty to send nothing."),
      }),
      run: ({ reason, message }) =>
        guarded("handover", async () => {
          const note = message.trim() ? checkText(message, HANDOVER_MESSAGE_MAX, "handover message") : "";
          const why = Array.from(reason.trim() || "No reason given").slice(0, REASON_MAX).join("");
          return act({ type: "handover", reason: why, message: note }, () => executor.handover(why, note));
        }),
    }),
  ].filter((t) => t !== false);

  const runner = ai.client.beta.messages.toolRunner({
    // the whole (short) turn in every request, rather than a conversation kept on Anthropic's side
    thread: false,
    model: ai.model,
    max_tokens: MAX_TOKENS,
    max_iterations: MAX_ITERATIONS,
    ...(ai.serverFallback ? { betas: [FALLBACK_BETA], fallbacks: "default" as const } : {}),
    output_config: { effort: "low" },
    system: input.system,
    tools,
    messages: [{ role: "user", content: input.prompt }],
  });

  let refused = false;
  let fallback = false;
  for await (const message of runner) {
    addUsage(usage, message.usage);
    if (message.usage.iterations?.some((i) => i.type === "fallback_message")) fallback = true;
    // a refusal can cut a tool call off mid-input: never run that response's tools
    if (message.stop_reason === "refusal") {
      refused = true;
      break;
    }
    // a call cut off at max_tokens may parse as a shorter, wrong input
    if (message.stop_reason === "max_tokens") break;
    // run this response's calls now, so the turn can end without another model call once it's answered
    await runner.generateToolResponse();
    if (fatal) throw fatal;
    if (sent || handedOver || halted) break;
  }
  if (fatal) throw fatal;
  return { actions, notes, refused, fallback, halted, usage };
}
