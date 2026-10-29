import { z } from "zod";

/*
 * Subscription providers (phase B10): RevenueCat, Superwall, Adapty and App Store Server Notifications v2 send
 * webhooks per app. Each is verified its own way, normalized to one of ten canonical events, matched to the
 * person's devices, and can start automations.
 */

export const Provider = z.enum(["revenuecat", "superwall", "adapty", "appstore"]);
export type Provider = z.infer<typeof Provider>;

export const PROVIDER_NAMES: Record<Provider, string> = {
  revenuecat: "RevenueCat",
  superwall: "Superwall",
  adapty: "Adapty",
  appstore: "App Store Server Notifications",
};

export const SUBSCRIPTION_EVENTS = [
  "trial_started",
  "trial_converted",
  "trial_cancelled",
  "trial_expired",
  "subscription_started",
  "subscription_renewed",
  "subscription_cancelled",
  "billing_issue",
  "subscription_expired",
  "refunded",
] as const;
export const SubscriptionEvent = z.enum(SUBSCRIPTION_EVENTS);
export type SubscriptionEvent = z.infer<typeof SubscriptionEvent>;

/** After these the person still has access (a cancelled subscription runs until it expires). */
export const PAYING_AFTER: Record<SubscriptionEvent, boolean> = {
  trial_started: true,
  trial_converted: true,
  trial_cancelled: true,
  trial_expired: false,
  subscription_started: true,
  subscription_renewed: true,
  subscription_cancelled: true,
  billing_issue: true,
  subscription_expired: false,
  refunded: false,
};

/** What a device's subscription looks like after the latest provider event. */
export const DeviceSubscription = z.object({
  status: z.enum(["trial", "active", "cancelled", "billing_issue", "expired", "refunded"]),
  paying: z.boolean(),
  provider: Provider,
  productId: z.string().nullable(),
  expiresAt: z.string().nullable(),
  updatedAt: z.string(),
});
export type DeviceSubscription = z.infer<typeof DeviceSubscription>;

/* ---------- dashboard ---------- */

export const IntegrationState = z.object({
  provider: Provider,
  connected: z.boolean(),
  /** Paste into the provider: our webhook URL for this app. */
  webhookUrl: z.string(),
  /** RevenueCat and Adapty: the Authorization header value to paste there (shown to admins). */
  authorization: z.string().nullable(),
  /** Superwall: whether its signing secret has been saved. */
  hasSigningSecret: z.boolean(),
  lastEventAt: z.string().nullable(),
});
export type IntegrationState = z.infer<typeof IntegrationState>;

/** Connect a provider. Superwall needs its `whsec_…` signing secret; the others need nothing. */
export const ConnectIntegrationInput = z
  .object({ signingSecret: z.string().trim().regex(/^whsec_[A-Za-z0-9+/=]{20,200}$/, "paste the whsec_… signing secret from Superwall").optional() })
  .strict();
export type ConnectIntegrationInput = z.infer<typeof ConnectIntegrationInput>;

export const ProviderEventStatus = z.enum(["accepted", "unmatched", "ignored", "test", "refused", "duplicate"]);
export type ProviderEventStatus = z.infer<typeof ProviderEventStatus>;

/** One line of the Recent events log. */
export const ProviderEventLog = z.object({
  id: z.string(),
  provider: Provider,
  rawType: z.string().nullable(),
  event: SubscriptionEvent.nullable(),
  status: ProviderEventStatus,
  reason: z.string().nullable(),
  environment: z.enum(["production", "sandbox"]).nullable(),
  /** The person, as the provider named them. */
  person: z.string().nullable(),
  devicesReached: z.number().int(),
  receivedAt: z.string(),
});
export type ProviderEventLog = z.infer<typeof ProviderEventLog>;
