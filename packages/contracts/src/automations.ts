import { z } from "zod";
import { BUTTON_LABEL_MAX, CARD_TEXT_MAX, PaywallId } from "./cards";
import { MESSAGE_MAX_LENGTH } from "./messaging";
import { SUBSCRIPTION_EVENTS } from "./subscriptions";

/*
 * Automations (phase B10): an event (one the app tracks, or a subscription event) starts a run for that person,
 * if they match the audience. After an optional wait, the run sends its steps from a chosen teammate: messages,
 * an offer, a rating request, with waits between them. Every step re-checks before it sends.
 */

/** Custom event names the app tracks: `paywall_declined`, `onboarding_completed`… */
export const EventName = z.string().regex(/^[a-z0-9_.-]{1,64}$/, "lowercase letters, digits, _ . or -, up to 64");

export const SUGGESTED_EVENTS = ["paywall_declined", "checkout_cancelled", "onboarding_completed", "app_open", "app_close"] as const;

export const isSubscriptionEvent = (name: string) => (SUBSCRIPTION_EVENTS as readonly string[]).includes(name);

export const AudienceRule = z
  .object({
    /** A metadata key the app sets. */
    key: z.string().min(1).max(64),
    op: z.enum(["equals", "not_equals", "contains", "exists", "not_exists"]),
    value: z.string().max(512).optional(),
  })
  .strict()
  .refine((r) => r.op === "exists" || r.op === "not_exists" || r.value !== undefined, { message: "this rule needs a value" });
export type AudienceRule = z.infer<typeof AudienceRule>;

export const Audience = z
  .object({
    segment: z.enum(["everyone", "not_paying", "paying"]).default("everyone"),
    rules: z.array(AudienceRule).max(4).default([]),
    /** Off: people with conversation activity in the last 24 h are skipped (and caught at a later event). */
    duringConversation: z.boolean().default(false),
  })
  .strict();
export type Audience = z.infer<typeof Audience>;

export const Wait = z.discriminatedUnion("type", [
  z.object({ type: z.literal("immediate") }).strict(),
  z.object({ type: z.literal("delay"), minutes: z.number().int().min(1).max(60 * 24 * 30) }).strict(),
  /** "Tomorrow at 10:00" is `{days: 1, time: "10:00"}`, in the person's own time zone. */
  z
    .object({ type: z.literal("local_time"), days: z.number().int().min(0).max(30), time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "HH:MM") })
    .strict(),
]);
export type Wait = z.infer<typeof Wait>;

const label = z
  .string()
  .trim()
  .max(BUTTON_LABEL_MAX)
  .nullish()
  .transform((v) => v || null);

export const AutomationStep = z.discriminatedUnion("type", [
  /** Opens the chat on the person's screen with the message (only for runs that send right away). */
  z.object({ type: z.literal("open_chat") }).strict(),
  z.object({ type: z.literal("message"), text: z.string().trim().min(1).max(MESSAGE_MAX_LENGTH) }).strict(),
  z.object({ type: z.literal("offer"), paywallId: PaywallId, text: z.string().trim().max(CARD_TEXT_MAX).default(""), buttonLabel: label }).strict(),
  z.object({ type: z.literal("rating"), text: z.string().trim().max(CARD_TEXT_MAX).default(""), buttonLabel: label }).strict(),
  /** Splits the flow: the steps after it go out later, after a re-check. */
  z.object({ type: z.literal("wait"), minutes: z.number().int().min(1).max(60 * 24 * 30) }).strict(),
]);
export type AutomationStep = z.infer<typeof AutomationStep>;

const AutomationFields = z
  .object({
    name: z.string().trim().min(1).max(100),
    enabled: z.boolean().default(false),
    trigger: z.object({ event: EventName, frequency: z.enum(["once", "every"]).default("once") }).strict(),
    audience: Audience.default({ segment: "everyone", rules: [], duringConversation: false }),
    wait: Wait.default({ type: "immediate" }),
    /** Push for the messages this sends. */
    withPush: z.boolean().default(true),
    steps: z
      .array(AutomationStep)
      .min(1)
      .max(8)
      .refine((s) => s.some((step) => step.type !== "wait" && step.type !== "open_chat"), { message: "add a message, offer or rating" }),
    /** The teammate the messages come from; null sends as the team. */
    senderUserId: z.string().min(1).max(100).nullable().default(null),
  })
  .strict();

export const AutomationInput = AutomationFields.refine((a) => !a.steps.some((s) => s.type === "open_chat") || a.wait.type === "immediate", {
    message: "Open chat only works for automations that send right away",
    path: ["steps"],
  });
export type AutomationInput = z.input<typeof AutomationInput>;
export type AutomationDefinition = z.output<typeof AutomationInput>;

export const RunStatus = z.enum(["scheduled", "running", "done", "skipped", "held", "ended"]);
export type RunStatus = z.infer<typeof RunStatus>;

/** Why a run didn't (or stopped) sending. */
export const RunReason = z.enum([
  "ongoing_conversation",
  "audience",
  "already_ran",
  "offer_unavailable",
  "already_asked",
  "no_app_store_id",
  "replied",
  "blocked",
  "signed_out",
  "disabled",
]);
export type RunReason = z.infer<typeof RunReason>;

export const Automation = AutomationFields.extend({ id: z.string(), createdAt: z.string(), updatedAt: z.string() });
export type Automation = z.infer<typeof Automation>;

/** Results: who got it, then opened the offer or tapped Rate, replied, or bought within 7 days. */
export const AutomationResults = z.object({
  sent: z.number().int(),
  opened: z.number().int(),
  replied: z.number().int(),
  bought: z.number().int(),
  scheduled: z.array(z.object({ runId: z.string(), deviceId: z.string(), person: z.string(), nextAt: z.string(), step: z.number().int() })),
  skipped: z.array(z.object({ runId: z.string(), deviceId: z.string(), person: z.string(), reason: RunReason, at: z.string(), status: RunStatus })),
});
export type AutomationResults = z.infer<typeof AutomationResults>;

/* ---------- SDK ---------- */

/** `POST /v1/track`. */
export const TrackInput = z.object({ event: EventName }).strict();
export type TrackInput = z.infer<typeof TrackInput>;

/** `sent`: an automation sent a message right away; `openChat`: the app should open the chat to show it. */
export const TrackResult = z.object({ sent: z.boolean(), openChat: z.boolean() });
export type TrackResult = z.infer<typeof TrackResult>;

/** `GET /v1/track/events`: the events an enabled automation listens for; the app sends only these. */
export const TrackedEvents = z.object({ events: z.array(z.string()), ttlSeconds: z.number().int() });
export type TrackedEvents = z.infer<typeof TrackedEvents>;
