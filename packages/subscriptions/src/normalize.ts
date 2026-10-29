import { createHash } from "node:crypto";
import type { Provider, SubscriptionEvent } from "@hshelby/contracts";
import { verifyAppleJws, type JwsOptions } from "./apple";

/*
 * Each provider's webhook, reduced to what the rest of the system needs: a dedupe key, one of the ten canonical
 * events (or a reason to ignore it), and the IDs that find the person's devices.
 */

export type Normalized = {
  provider: Provider;
  /** Providers redeliver; this makes the second delivery a no-op. */
  eventId: string;
  rawType: string;
  /** Null when the event is accepted but means nothing here (uncancellation, product change…) or is a test. */
  event: SubscriptionEvent | null;
  kind: "event" | "ignored" | "test";
  environment: "production" | "sandbox" | null;
  match: {
    /** The app's own user IDs (what identify() set). */
    userIds: string[];
    /** IDs the provider knows the person by, matched against the sticky metadata key (revenuecat_id…). */
    providerIds: string[];
    /** App Store: the subscription's original transaction ID, as the SDK reported it. */
    originalTransactionId?: string;
    /** App Store: appAccountToken, the user ID when the app set it at purchase. */
    appAccountToken?: string;
  };
  /** How the log names the person. */
  person: string | null;
  productId: string | null;
  expiresAt: string | null;
  /** App Store: the app the notification is for. */
  bundleId?: string;
};

export class PayloadRejected extends Error {}

const str = (v: unknown) => (typeof v === "string" && v.length > 0 ? v : undefined);
const ids = (...values: unknown[]) => [...new Set(values.flat().map(str).filter((v): v is string => Boolean(v)))];
const iso = (ms: unknown) => (typeof ms === "number" && ms > 0 ? new Date(ms).toISOString() : typeof ms === "string" && ms ? new Date(ms).toISOString() : null);
const environment = (v: unknown) => (typeof v === "string" ? (v.toLowerCase() === "sandbox" ? "sandbox" : "production") : null);
const hash = (body: string) => createHash("sha256").update(body).digest("hex");

function result(n: Omit<Normalized, "kind" | "event"> & { event: SubscriptionEvent | "test" | null }): Normalized {
  if (n.event === "test") return { ...n, event: null, kind: "test" };
  return { ...n, event: n.event, kind: n.event ? "event" : "ignored" };
}

/* ---------- RevenueCat ---------- */

type RcEvent = {
  id?: string;
  type?: string;
  app_user_id?: string;
  original_app_user_id?: string;
  aliases?: string[];
  period_type?: string;
  is_trial_conversion?: boolean;
  cancel_reason?: string;
  environment?: string;
  product_id?: string;
  expiration_at_ms?: number;
};

/** RevenueCat: `{api_version, event: {type, period_type, …}}`. A refund is a CANCELLATION for CUSTOMER_SUPPORT. */
export function normalizeRevenueCat(body: unknown, raw: string): Normalized {
  const e = (body as { event?: RcEvent })?.event;
  if (!e?.type) throw new PayloadRejected("not a RevenueCat event");
  const trial = e.period_type === "TRIAL";
  const event: SubscriptionEvent | "test" | null = (() => {
    switch (e.type) {
      case "TEST":
        return "test";
      case "INITIAL_PURCHASE":
        return trial ? "trial_started" : "subscription_started";
      case "RENEWAL":
        return e.is_trial_conversion ? "trial_converted" : "subscription_renewed";
      case "CANCELLATION":
        if (e.cancel_reason === "CUSTOMER_SUPPORT") return "refunded";
        return trial ? "trial_cancelled" : "subscription_cancelled";
      case "EXPIRATION":
        return trial ? "trial_expired" : "subscription_expired";
      case "BILLING_ISSUE":
        return "billing_issue";
      default:
        // UNCANCELLATION, PRODUCT_CHANGE, NON_RENEWING_PURCHASE, TRANSFER, SUBSCRIPTION_PAUSED, SUBSCRIPTION_EXTENDED…
        return null;
    }
  })();
  const people = ids(e.app_user_id, e.original_app_user_id, e.aliases ?? []);
  return result({
    provider: "revenuecat",
    eventId: e.id ?? hash(raw),
    rawType: e.type,
    event,
    environment: environment(e.environment),
    match: { userIds: people, providerIds: people },
    person: e.app_user_id ?? e.original_app_user_id ?? null,
    productId: e.product_id ?? null,
    expiresAt: iso(e.expiration_at_ms),
  });
}

/* ---------- Superwall ---------- */

type SwData = {
  id?: string;
  periodType?: string;
  isTrialConversion?: boolean;
  cancelReason?: string | null;
  price?: number;
  environment?: string;
  productId?: string;
  expirationAt?: number | null;
  originalAppUserId?: string | null;
  originalTransactionId?: string;
  bundleId?: string;
};

/**
 * Superwall: `{object: "event", type, data: {…}}` with RevenueCat-like lowercase types. Refunds are transactions
 * with a negative price (or a cancellation for CUSTOMER_SUPPORT).
 */
export function normalizeSuperwall(body: unknown, raw: string, deliveryId?: string): Normalized {
  const b = body as { type?: string; data?: SwData };
  if (!b?.type || !b.data) throw new PayloadRejected("not a Superwall event");
  const d = b.data;
  const trial = d.periodType === "TRIAL";
  const refund = typeof d.price === "number" && d.price < 0;
  const event: SubscriptionEvent | "test" | null = (() => {
    if (refund) return "refunded";
    switch (b.type) {
      case "test":
        return "test";
      case "initial_purchase":
        return trial ? "trial_started" : "subscription_started";
      case "renewal":
        return d.isTrialConversion ? "trial_converted" : "subscription_renewed";
      case "cancellation":
        if (d.cancelReason === "CUSTOMER_SUPPORT") return "refunded";
        return trial ? "trial_cancelled" : "subscription_cancelled";
      case "expiration":
        return trial ? "trial_expired" : "subscription_expired";
      case "billing_issue":
        return "billing_issue";
      default:
        // uncancellation, product_change, subscription_paused, non_renewing_purchase
        return null;
    }
  })();
  const people = ids(d.originalAppUserId);
  return result({
    provider: "superwall",
    eventId: d.id ?? deliveryId ?? hash(raw),
    rawType: b.type,
    event,
    environment: environment(d.environment),
    match: { userIds: people, providerIds: people, originalTransactionId: str(d.originalTransactionId) },
    person: d.originalAppUserId ?? null,
    productId: d.productId ?? null,
    expiresAt: iso(d.expirationAt),
    bundleId: d.bundleId,
  });
}

/* ---------- Adapty ---------- */

const ADAPTY: Record<string, SubscriptionEvent> = {
  trial_started: "trial_started",
  trial_converted: "trial_converted",
  trial_renewal_cancelled: "trial_cancelled",
  trial_expired: "trial_expired",
  subscription_started: "subscription_started",
  subscription_renewed: "subscription_renewed",
  subscription_renewal_cancelled: "subscription_cancelled",
  billing_issue_detected: "billing_issue",
  entered_grace_period: "billing_issue",
  subscription_expired: "subscription_expired",
  subscription_refunded: "refunded",
};

/** Adapty sends `{}` to check the URL when the webhook is saved; any 2xx JSON answer completes the setup. */
export const isAdaptyUrlCheck = (body: unknown) => Boolean(body) && typeof body === "object" && Object.keys(body as object).length === 0;

/** Adapty: `{profile_id, customer_user_id, event_type, event_properties: {…}}`. */
export function normalizeAdapty(body: unknown, raw: string): Normalized {
  const b = body as {
    profile_id?: string;
    customer_user_id?: string;
    event_type?: string;
    event_properties?: {
      profile_event_id?: string;
      environment?: string;
      vendor_product_id?: string;
      subscription_expires_at?: string;
      original_transaction_id?: string;
    };
  };
  if (!b?.event_type) throw new PayloadRejected("not an Adapty event");
  const p = b.event_properties ?? {};
  return result({
    provider: "adapty",
    eventId: p.profile_event_id ?? hash(raw),
    rawType: b.event_type,
    // subscription_active, trial_active, *_reactivated, paused, deferred, non-subscription purchases, access levels
    event: ADAPTY[b.event_type] ?? null,
    environment: environment(p.environment),
    match: { userIds: ids(b.customer_user_id), providerIds: ids(b.profile_id), originalTransactionId: str(p.original_transaction_id) },
    person: b.customer_user_id ?? b.profile_id ?? null,
    productId: p.vendor_product_id ?? null,
    expiresAt: iso(p.subscription_expires_at),
  });
}

/* ---------- App Store Server Notifications v2 ---------- */

type AsnPayload = {
  notificationType?: string;
  subtype?: string;
  notificationUUID?: string;
  data?: { bundleId?: string; environment?: string; signedTransactionInfo?: string };
};
type AsnTransaction = {
  originalTransactionId?: string;
  productId?: string;
  expiresDate?: number;
  offerType?: number;
  offerDiscountType?: string;
  appAccountToken?: string;
};

/**
 * App Store: `{signedPayload}`, a JWS signed by Apple, whose data carries the transaction as another JWS. Apple
 * reports a converted trial as a plain DID_RENEW, so it's subscription_renewed here.
 */
export function normalizeAppStore(body: unknown, options: JwsOptions = {}): Normalized {
  const signed = (body as { signedPayload?: string })?.signedPayload;
  if (typeof signed !== "string") throw new PayloadRejected("missing signedPayload");
  const n = verifyAppleJws<AsnPayload>(signed, options);
  const type = n.notificationType;
  if (!type || !n.notificationUUID) throw new PayloadRejected("not a notification");
  const tx = n.data?.signedTransactionInfo ? verifyAppleJws<AsnTransaction>(n.data.signedTransactionInfo, options) : {};
  // an introductory free trial (offerType 1; older payloads don't say the discount type)
  const trial = tx.offerType === 1 && (tx.offerDiscountType === undefined || tx.offerDiscountType === "FREE_TRIAL");
  const event: SubscriptionEvent | "test" | null = (() => {
    switch (type) {
      case "TEST":
        return "test";
      case "SUBSCRIBED":
        return n.subtype === "INITIAL_BUY" && trial ? "trial_started" : "subscription_started";
      case "DID_RENEW":
        return "subscription_renewed";
      case "DID_CHANGE_RENEWAL_STATUS":
        if (n.subtype !== "AUTO_RENEW_DISABLED") return null;
        return trial ? "trial_cancelled" : "subscription_cancelled";
      case "DID_FAIL_TO_RENEW":
        return "billing_issue";
      case "EXPIRED":
        return trial ? "trial_expired" : "subscription_expired";
      case "GRACE_PERIOD_EXPIRED":
        return "subscription_expired";
      case "REFUND":
        return "refunded";
      default:
        // DID_CHANGE_RENEWAL_PREF, OFFER_REDEEMED, PRICE_INCREASE, REFUND_DECLINED, RENEWAL_EXTENDED, CONSUMPTION_REQUEST…
        return null;
    }
  })();
  return result({
    provider: "appstore",
    eventId: n.notificationUUID,
    rawType: n.subtype ? `${type}/${n.subtype}` : type,
    event,
    environment: environment(n.data?.environment),
    match: { userIds: [], providerIds: [], originalTransactionId: str(tx.originalTransactionId), appAccountToken: str(tx.appAccountToken)?.toLowerCase() },
    person: tx.appAccountToken ?? (tx.originalTransactionId ? `Transaction ${tx.originalTransactionId}` : null),
    productId: tx.productId ?? null,
    expiresAt: iso(tx.expiresDate),
    bundleId: n.data?.bundleId,
  });
}
