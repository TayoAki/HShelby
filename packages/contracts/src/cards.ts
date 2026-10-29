import { z } from "zod";

/*
 * Cards are agent messages with a button: a review request opens the App Store's review page, an offer opens
 * one of the app's paywalls. The app reports which paywalls it can show right now; an offer can only name one
 * of those. The first tap on a card is recorded once (a click receipt).
 */

export const MessageKind = z.enum(["text", "review", "paywall"]);
export type MessageKind = z.infer<typeof MessageKind>;

export const CARD_TEXT_MAX = 1000;
export const BUTTON_LABEL_MAX = 40;
export const PAYWALL_LIMITS = { perDevice: 20, id: 64, title: 60, productsPerPaywall: 10, productsTotal: 40 } as const;

export const ReviewScenario = z.enum(["general", "after_helping", "after_feedback"]);
export type ReviewScenario = z.infer<typeof ReviewScenario>;

/** The review templates a new app starts with. `{app}` is the app's name. */
export const DEFAULT_REVIEW_TEMPLATES: Record<ReviewScenario, string> = {
  general: "Enjoying {app}? A quick rating on the App Store helps us a lot.",
  after_helping: "Glad we could help! If you have a moment, a rating for {app} would mean a lot to us.",
  after_feedback: "Thanks for the feedback! If {app} works well for you, would you leave us a rating?",
};

/** Where a review card leads; computed when the message is read, from the app's current App Store ID. */
export const appStoreReviewUrl = (appStoreId: string | null) =>
  appStoreId ? `https://apps.apple.com/app/id${appStoreId}?action=write-review` : null;

/* ---------- paywalls the app reports ---------- */

export const PaywallId = z.string().regex(/^[A-Za-z0-9_.-]{1,64}$/, "1–64 letters, digits, _ . or -");

export const PaywallSource = z.enum(["revenuecat", "superwall", "adapty", "app"]);
export type PaywallSource = z.infer<typeof PaywallSource>;

/** A product on a paywall, as StoreKit or the vendor SDK localized it. `period` and `trial` are ISO 8601 durations. */
export const PaywallProduct = z
  .object({
    id: z.string().trim().min(1).max(200),
    price: z.string().trim().max(50).optional(),
    period: z.string().trim().max(20).optional(),
    trial: z.string().trim().max(20).optional(),
  })
  .strict();
export type PaywallProduct = z.infer<typeof PaywallProduct>;

/** A paywall the app can show. Titles are for the team; customers never see them. */
export const ReportedPaywall = z
  .object({
    id: PaywallId,
    title: z.string().trim().min(1).max(PAYWALL_LIMITS.title),
    source: PaywallSource.default("app"),
    /** False when the vendor has the paywall but can't present it on this device (e.g. no paywall design). */
    presentable: z.boolean().default(true),
    products: z.array(PaywallProduct).max(PAYWALL_LIMITS.productsPerPaywall).default([]),
  })
  .strict();
export type ReportedPaywall = z.infer<typeof ReportedPaywall>;

/** The device's available paywalls, replaced as a whole on every report. `[]` means none right now. */
export const ReportedPaywalls = z
  .array(ReportedPaywall)
  .max(PAYWALL_LIMITS.perDevice)
  .refine((list) => new Set(list.map((p) => p.id)).size === list.length, { message: "paywall IDs repeat" })
  .refine((list) => list.reduce((n, p) => n + p.products.length, 0) <= PAYWALL_LIMITS.productsTotal, {
    message: `at most ${PAYWALL_LIMITS.productsTotal} products in total`,
  });

/** Whether an offer for this paywall can go to the device: it reported it, and can present it. */
export const isPaywallAvailable = (paywalls: ReportedPaywall[], id: string) =>
  paywalls.some((p) => p.id === id && p.presentable);

/* ---------- what a card message carries ---------- */

/** Stored on the message. An offer keeps the title it was sent with, even if the paywall is renamed later. */
export type StoredCard =
  | { type: "review"; scenario: ReviewScenario | null; buttonLabel: string | null }
  | { type: "paywall"; paywallId: string; paywallTitle: string; buttonLabel: string | null };

/**
 * The SDK's view of a card. A null `buttonLabel` means the SDK's default ("Rate on the App Store", "View offer")
 * in the user's language. A review card without `url` shows its text without a button; an offer whose
 * `paywallId` the app no longer has shows "No longer available".
 */
export const SdkCard = z.discriminatedUnion("type", [
  z.object({ type: z.literal("review"), url: z.string().nullable(), buttonLabel: z.string().nullable() }),
  z.object({ type: z.literal("paywall"), paywallId: z.string(), buttonLabel: z.string().nullable() }),
]);
export type SdkCard = z.infer<typeof SdkCard>;

/** The team's view of a card. */
export const InboxCard = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("review"),
    url: z.string().nullable(),
    scenario: ReviewScenario.nullable(),
    buttonLabel: z.string().nullable(),
  }),
  z.object({ type: z.literal("paywall"), paywallId: z.string(), paywallTitle: z.string(), buttonLabel: z.string().nullable() }),
]);
export type InboxCard = z.infer<typeof InboxCard>;

/** How a message reads in a list or a notification when it has no text. */
export function messagePreview(m: { text: string; kind: MessageKind; card?: StoredCard | null }) {
  if (m.text) return m.text;
  if (m.kind === "review") return "Asked for a rating";
  if (m.kind === "paywall") return m.card?.type === "paywall" ? `Sent an offer: ${m.card.paywallTitle}` : "Sent an offer";
  return "Photo";
}

/* ---------- SDK: click receipts ---------- */

/** `POST /v1/actions/:messageId/click`. `clickedAt` lets the SDK send a receipt it cached offline. */
export const ActionClickInput = z.object({ clickedAt: z.iso.datetime({ offset: true }).optional() }).strict();
export type ActionClickInput = z.infer<typeof ActionClickInput>;

/** `first` is false when an earlier tap was already recorded; `actionClickedAt` is always the first one. */
export const ActionClickResult = z.object({ actionClickedAt: z.string(), first: z.boolean() });
export type ActionClickResult = z.infer<typeof ActionClickResult>;

/* ---------- dashboard: sending a card ---------- */

const cardText = z.string().trim().max(CARD_TEXT_MAX).default("");
const buttonLabel = z
  .string()
  .trim()
  .max(BUTTON_LABEL_MAX)
  .nullish()
  .transform((v) => v || null);

/**
 * `POST /api/conversations/:id/cards`. `confirmRepeat` is the "send review" / "send offer" confirmation the
 * dashboard asks for when the last card of that kind got no reply.
 */
export const SendCardInput = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("review"),
      clientId: z.uuid(),
      text: cardText,
      buttonLabel,
      scenario: ReviewScenario.nullish().transform((v) => v ?? null),
      confirmRepeat: z.boolean().default(false),
    })
    .strict(),
  z
    .object({
      kind: z.literal("paywall"),
      clientId: z.uuid(),
      paywallId: PaywallId,
      text: cardText,
      buttonLabel,
      confirmRepeat: z.boolean().default(false),
    })
    .strict(),
]);
export type SendCardInput = z.input<typeof SendCardInput>;

/* ---------- dashboard: settings, paywall registry, stats ---------- */

const labels = z.array(z.string().trim().min(1).max(BUTTON_LABEL_MAX)).max(5);

/** Per app: the review templates and the button labels teammates can pick from (the first is the default). */
export const CardSettings = z.object({
  appStoreId: z.string().nullable(),
  reviewTemplates: z.record(ReviewScenario, z.string()),
  reviewButtonLabels: z.array(z.string()),
  offerButtonLabels: z.array(z.string()),
});
export type CardSettings = z.infer<typeof CardSettings>;

export const CardSettingsInput = z
  .object({
    reviewTemplates: z.object({
      general: z.string().trim().min(1).max(500),
      after_helping: z.string().trim().min(1).max(500),
      after_feedback: z.string().trim().min(1).max(500),
    }),
    reviewButtonLabels: labels,
    offerButtonLabels: labels,
  })
  .partial()
  .strict();
export type CardSettingsInput = z.infer<typeof CardSettingsInput>;

/** A paywall any of the app's devices reported, for the app's Paywalls page and the automation builder. */
export const AppPaywall = z.object({
  id: z.string(),
  title: z.string(),
  source: PaywallSource,
  presentable: z.boolean(),
  products: z.array(PaywallProduct),
  firstReportedAt: z.string(),
  lastReportedAt: z.string(),
});
export type AppPaywall = z.infer<typeof AppPaywall>;

export const CardStatsQuery = z.object({ days: z.coerce.number().pipe(z.union([z.literal(7), z.literal(30), z.literal(90)])).default(30) });
export type CardStatsQuery = z.infer<typeof CardStatsQuery>;

const opens = { sent: z.number().int(), opened: z.number().int() };

/** Sent cards and first opens over the last `days`, by sender and by paywall. */
export const CardStats = z.object({
  days: z.number().int(),
  review: z.object(opens),
  offer: z.object(opens),
  bySender: z.array(
    z.object({
      source: z.enum(["dashboard", "telegram", "automation", "ai"]),
      author: z.object({ id: z.string(), name: z.string() }).nullable(),
      review: z.object(opens),
      offer: z.object(opens),
    }),
  ),
  byPaywall: z.array(z.object({ paywallId: z.string(), title: z.string(), ...opens })),
});
export type CardStats = z.infer<typeof CardStats>;
