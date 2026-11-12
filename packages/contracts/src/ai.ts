import { z } from "zod";

/*
 * AI replies (phase B11). When an app turns them on, a person's message gets an answer from Claude a few seconds
 * after they stop typing: a reply, an offer, a rating request, or a handover to the team. A teammate's reply
 * pauses the AI on that conversation until someone hands it back (or the conversation is resolved).
 */

export const AI_LIMITS = { name: 40, instructions: 4_000, docs: 200_000 } as const;

export const AiSettingsInput = z
  .object({
    enabled: z.boolean(),
    /** What the person sees as the author of the AI's messages (with "Show team names"). */
    name: z.string().trim().min(1).max(AI_LIMITS.name),
    /** The team's own guidance: tone, what to escalate, what never to say. */
    instructions: z.string().max(AI_LIMITS.instructions),
    /** The app's help docs, FAQ, policies: what the AI answers from. */
    docs: z.string().max(AI_LIMITS.docs),
    allowOffers: z.boolean(),
    allowReviews: z.boolean(),
  })
  .strict();
export type AiSettingsInput = z.infer<typeof AiSettingsInput>;

export const DEFAULT_AI_SETTINGS: AiSettingsInput = {
  enabled: false,
  name: "Assistant",
  instructions: "",
  docs: "",
  allowOffers: true,
  allowReviews: true,
};

export const AiSettings = AiSettingsInput.extend({ updatedAt: z.string().nullable() });
export type AiSettings = z.infer<typeof AiSettings>;

/** `active`: the AI answers. `paused`: a teammate replied. `handed_over`: the AI asked for a teammate. */
export const AiState = z.enum(["active", "paused", "handed_over"]);
export type AiState = z.infer<typeof AiState>;

/**
 * What the person said in the chat about AI replies (App Review guideline 5.1.2(i): their messages go to a
 * third-party AI only after they allow it). Null until they choose; the AI never answers without `granted`.
 */
export const AiConsent = z.enum(["granted", "declined"]);
export type AiConsent = z.infer<typeof AiConsent>;

/** `POST /v1/ai-consent`: the person's choice in the chat. */
export const AiConsentInput = z.object({ consent: AiConsent }).strict();
export type AiConsentInput = z.infer<typeof AiConsentInput>;

/**
 * The chat's AI state, in `GET /v1/conversation`: whether the app's AI may answer (so the chat asks), the
 * person's choice, and who processes the messages when they allow it (named in the chat's question).
 */
export const SdkAi = z.object({ enabled: z.boolean(), consent: AiConsent.nullable(), processors: z.array(z.string()) });
export type SdkAi = z.infer<typeof SdkAi>;

export const AiConversation = z.object({
  state: AiState,
  reason: z.string().nullable(),
  at: z.string().nullable(),
  /** The person's choice in the chat; the AI only answers people who allowed it. */
  consent: AiConsent.nullable(),
});
export type AiConversation = z.infer<typeof AiConversation>;

/** `POST /api/conversations/:id/ai`: hand the conversation back to the AI, or pause it. */
export const AiStateInput = z.object({ state: z.enum(["active", "paused"]) }).strict();
export type AiStateInput = z.infer<typeof AiStateInput>;

/** What the AI did in one turn. A refused action (an unavailable paywall…) isn't listed; it's in `notes`. */
export const AiAction = z.discriminatedUnion("type", [
  z.object({ type: z.literal("reply"), text: z.string() }),
  z.object({ type: z.literal("offer"), paywallId: z.string(), text: z.string() }),
  z.object({ type: z.literal("review"), text: z.string() }),
  z.object({ type: z.literal("handover"), reason: z.string(), message: z.string() }),
]);
export type AiAction = z.infer<typeof AiAction>;

/** `stopped`: the conversation moved on while the AI was thinking (the person wrote again, a teammate replied). */
export const AiOutcome = z.enum(["replied", "sent_offer", "asked_review", "handed_over", "stopped", "failed"]);
export type AiOutcome = z.infer<typeof AiOutcome>;

export const AiUsage = z.object({
  inputTokens: z.number().int(),
  outputTokens: z.number().int(),
  cacheReadTokens: z.number().int(),
  cacheWriteTokens: z.number().int(),
});
export type AiUsage = z.infer<typeof AiUsage>;

export const AiRun = z.object({
  id: z.string(),
  conversationId: z.string(),
  person: z.string(),
  outcome: AiOutcome,
  actions: z.array(AiAction),
  notes: z.array(z.string()),
  error: z.string().nullable(),
  /** The model declined and another model answered (server-side fallback). */
  fallback: z.boolean(),
  usage: AiUsage,
  latencyMs: z.number().int(),
  createdAt: z.string(),
});
export type AiRun = z.infer<typeof AiRun>;

/** The app's AI page: settings, whether the server has a model key, and the last 30 days. */
export const AiOverview = z.object({
  settings: AiSettings,
  available: z.boolean(),
  /** The model answering (an OpenRouter model ID when the server goes through OpenRouter); null when unavailable. */
  model: z.string().nullable(),
  last30Days: z.object({ runs: z.number().int(), replied: z.number().int(), handedOver: z.number().int(), failed: z.number().int(), usage: AiUsage }),
});
export type AiOverview = z.infer<typeof AiOverview>;

// 4,000 is a message's length limit (MESSAGE_MAX_LENGTH, not imported: messaging imports this module)
const PreviewMessage = z.object({ sender: z.enum(["user", "agent"]), text: z.string().trim().min(1).max(4000) }).strict();

/**
 * `POST /api/apps/:id/ai/preview`: what the AI would do, without sending anything. Either a made-up exchange
 * or a real conversation's history; `settings` tries unsaved edits.
 */
export const AiPreviewInput = z
  .object({
    settings: AiSettingsInput.omit({ enabled: true }).optional(),
    messages: z.array(PreviewMessage).min(1).max(20).optional(),
    conversationId: z.uuid().optional(),
  })
  .strict()
  .refine((v) => (v.messages === undefined) !== (v.conversationId === undefined), { message: "send either messages or conversationId" });
export type AiPreviewInput = z.infer<typeof AiPreviewInput>;

export const AiPreview = z.object({
  actions: z.array(AiAction),
  notes: z.array(z.string()),
  refused: z.boolean(),
  fallback: z.boolean(),
  usage: AiUsage,
  latencyMs: z.number().int(),
});
export type AiPreview = z.infer<typeof AiPreview>;
