import { createPrivateKey, randomUUID, sign, X509Certificate } from "node:crypto";
import type { SubscriptionEvent } from "@hshelby/contracts";
import { TEST_INTERMEDIATE_PEM, TEST_LEAF_KEY_PEM, TEST_LEAF_PEM, TEST_ROOT_PEM } from "./fixtures/test-chain";

/*
 * Webhook fixtures for each provider, shaped like their documented payloads, with the canonical event each
 * should become; and an App Store signer using a test certificate chain (trust it with `TEST_ROOTS`).
 */

export const TEST_ROOTS = [TEST_ROOT_PEM];

const der = (pem: string) => new X509Certificate(pem).raw.toString("base64");
const b64url = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");

/** Signs a payload the way Apple signs notifications and transactions (ES256, x5c chain in the header). */
export function signAppleJws(payload: unknown) {
  const header = b64url({ alg: "ES256", x5c: [der(TEST_LEAF_PEM), der(TEST_INTERMEDIATE_PEM), der(TEST_ROOT_PEM)] });
  const body = b64url(payload);
  const signature = sign("sha256", Buffer.from(`${header}.${body}`), { key: createPrivateKey(TEST_LEAF_KEY_PEM), dsaEncoding: "ieee-p1363" });
  return `${header}.${body}.${signature.toString("base64url")}`;
}

export type Fixture = { name: string; body: unknown; expected: SubscriptionEvent | "ignored" | "test" };

const hour = 3600_000;

/* ---------- RevenueCat ---------- */

export function revenueCatEvent(type: string, over: Record<string, unknown> = {}) {
  return {
    api_version: "1.0",
    event: {
      id: randomUUID().toUpperCase(),
      type,
      app_id: "app1234",
      app_user_id: "user-42",
      original_app_user_id: "$RCAnonymousID:8a6f",
      aliases: ["$RCAnonymousID:8a6f", "user-42"],
      event_timestamp_ms: Date.now(),
      environment: "PRODUCTION",
      store: "APP_STORE",
      product_id: "pro.yearly",
      period_type: "NORMAL",
      purchased_at_ms: Date.now() - hour,
      expiration_at_ms: Date.now() + 365 * 24 * hour,
      is_trial_conversion: false,
      cancel_reason: null,
      currency: "USD",
      price: 39.99,
      ...over,
    },
  };
}

export const revenueCatFixtures = (): Fixture[] => [
  { name: "trial purchase", body: revenueCatEvent("INITIAL_PURCHASE", { period_type: "TRIAL" }), expected: "trial_started" },
  { name: "paid purchase", body: revenueCatEvent("INITIAL_PURCHASE"), expected: "subscription_started" },
  { name: "trial conversion", body: revenueCatEvent("RENEWAL", { is_trial_conversion: true }), expected: "trial_converted" },
  { name: "renewal", body: revenueCatEvent("RENEWAL"), expected: "subscription_renewed" },
  { name: "trial cancelled", body: revenueCatEvent("CANCELLATION", { period_type: "TRIAL", cancel_reason: "UNSUBSCRIBE" }), expected: "trial_cancelled" },
  { name: "cancelled", body: revenueCatEvent("CANCELLATION", { cancel_reason: "UNSUBSCRIBE" }), expected: "subscription_cancelled" },
  { name: "refund", body: revenueCatEvent("CANCELLATION", { cancel_reason: "CUSTOMER_SUPPORT" }), expected: "refunded" },
  { name: "billing issue", body: revenueCatEvent("BILLING_ISSUE"), expected: "billing_issue" },
  { name: "trial expired", body: revenueCatEvent("EXPIRATION", { period_type: "TRIAL", expiration_reason: "UNSUBSCRIBE" }), expected: "trial_expired" },
  { name: "expired", body: revenueCatEvent("EXPIRATION", { expiration_reason: "BILLING_ERROR" }), expected: "subscription_expired" },
  { name: "uncancellation", body: revenueCatEvent("UNCANCELLATION"), expected: "ignored" },
  { name: "product change", body: revenueCatEvent("PRODUCT_CHANGE", { new_product_id: "pro.monthly" }), expected: "ignored" },
  { name: "test", body: revenueCatEvent("TEST", { app_user_id: "test-user" }), expected: "test" },
];

/* ---------- Superwall ---------- */

export function superwallEvent(type: string, over: Record<string, unknown> = {}) {
  return {
    object: "event",
    type,
    projectId: 1234,
    applicationId: 5678,
    timestamp: Date.now(),
    data: {
      id: `evt_${randomUUID().replaceAll("-", "")}`,
      name: type,
      cancelReason: null,
      exchangeRate: 1,
      isSmallBusiness: true,
      periodType: "NORMAL",
      countryCode: "US",
      price: 39.99,
      proceeds: 33.99,
      currencyCode: "USD",
      isFamilyShare: false,
      isTrialConversion: false,
      expirationAt: Date.now() + 365 * 24 * hour,
      transactionId: "2000000812345678",
      originalTransactionId: "2000000800000001",
      originalAppUserId: "user-42",
      store: "APP_STORE",
      purchasedAt: Date.now() - hour,
      productId: "pro.yearly",
      environment: "PRODUCTION",
      bundleId: "com.example.lockdlist",
      ts: Date.now(),
      ...over,
    },
  };
}

export const superwallFixtures = (): Fixture[] => [
  { name: "trial purchase", body: superwallEvent("initial_purchase", { periodType: "TRIAL", price: 0 }), expected: "trial_started" },
  { name: "paid purchase", body: superwallEvent("initial_purchase"), expected: "subscription_started" },
  { name: "trial conversion", body: superwallEvent("renewal", { isTrialConversion: true }), expected: "trial_converted" },
  { name: "renewal", body: superwallEvent("renewal"), expected: "subscription_renewed" },
  { name: "trial cancelled", body: superwallEvent("cancellation", { periodType: "TRIAL", cancelReason: "UNSUBSCRIBE", price: 0 }), expected: "trial_cancelled" },
  { name: "cancelled", body: superwallEvent("cancellation", { cancelReason: "UNSUBSCRIBE", price: 0 }), expected: "subscription_cancelled" },
  { name: "refund", body: superwallEvent("cancellation", { cancelReason: "CUSTOMER_SUPPORT", price: -39.99, proceeds: -33.99 }), expected: "refunded" },
  { name: "billing issue", body: superwallEvent("billing_issue", { price: 0 }), expected: "billing_issue" },
  { name: "trial expired", body: superwallEvent("expiration", { periodType: "TRIAL", price: 0 }), expected: "trial_expired" },
  { name: "expired", body: superwallEvent("expiration", { price: 0 }), expected: "subscription_expired" },
  { name: "uncancellation", body: superwallEvent("uncancellation", { price: 0 }), expected: "ignored" },
  { name: "product change", body: superwallEvent("product_change", { newProductId: "pro.monthly" }), expected: "ignored" },
];

/* ---------- Adapty ---------- */

export function adaptyEvent(eventType: string, over: Record<string, unknown> = {}) {
  return {
    profile_id: "4f7c1d3e-9a2b-4c8d-b1e6-0a9f8e7d6c5b",
    customer_user_id: "user-42",
    idfv: "8B1B7C2E-3F4A-4D5E-9A8B-7C6D5E4F3A2B",
    event_type: eventType,
    event_datetime: new Date().toISOString(),
    event_properties: {
      profile_event_id: randomUUID(),
      environment: "Production",
      store: "app_store",
      vendor_product_id: "pro.yearly",
      original_transaction_id: "2000000800000001",
      transaction_id: "2000000812345678",
      subscription_expires_at: new Date(Date.now() + 365 * 24 * hour).toISOString(),
      price_usd: 39.99,
    },
    event_api_version: 1,
    ...over,
  };
}

export const adaptyFixtures = (): Fixture[] => [
  { name: "trial started", body: adaptyEvent("trial_started"), expected: "trial_started" },
  { name: "trial converted", body: adaptyEvent("trial_converted"), expected: "trial_converted" },
  { name: "trial cancelled", body: adaptyEvent("trial_renewal_cancelled"), expected: "trial_cancelled" },
  { name: "trial expired", body: adaptyEvent("trial_expired"), expected: "trial_expired" },
  { name: "started", body: adaptyEvent("subscription_started"), expected: "subscription_started" },
  { name: "renewed", body: adaptyEvent("subscription_renewed"), expected: "subscription_renewed" },
  { name: "cancelled", body: adaptyEvent("subscription_renewal_cancelled"), expected: "subscription_cancelled" },
  { name: "billing issue", body: adaptyEvent("billing_issue_detected"), expected: "billing_issue" },
  { name: "grace period", body: adaptyEvent("entered_grace_period"), expected: "billing_issue" },
  { name: "expired", body: adaptyEvent("subscription_expired"), expected: "subscription_expired" },
  { name: "refunded", body: adaptyEvent("subscription_refunded"), expected: "refunded" },
  { name: "reactivated", body: adaptyEvent("subscription_renewal_reactivated"), expected: "ignored" },
  { name: "access level", body: adaptyEvent("access_level_updated"), expected: "ignored" },
];

/* ---------- App Store Server Notifications v2 ---------- */

export function appStoreNotification(
  notificationType: string,
  subtype: string | undefined,
  options: { trial?: boolean; bundleId?: string; originalTransactionId?: string; appAccountToken?: string; environment?: string } = {},
) {
  const transaction = {
    transactionId: "2000000812345678",
    originalTransactionId: options.originalTransactionId ?? "2000000800000001",
    bundleId: options.bundleId ?? "com.example.lockdlist",
    productId: "pro.yearly",
    purchaseDate: Date.now() - hour,
    expiresDate: Date.now() + (options.trial ? 7 : 365) * 24 * hour,
    type: "Auto-Renewable Subscription",
    inAppOwnershipType: "PURCHASED",
    environment: options.environment ?? "Production",
    ...(options.appAccountToken && { appAccountToken: options.appAccountToken }),
    ...(options.trial && { offerType: 1, offerDiscountType: "FREE_TRIAL" }),
    signedDate: Date.now(),
  };
  const payload = {
    notificationType,
    ...(subtype && { subtype }),
    notificationUUID: randomUUID(),
    version: "2.0",
    signedDate: Date.now(),
    data: {
      appAppleId: 6700000001,
      bundleId: options.bundleId ?? "com.example.lockdlist",
      bundleVersion: "42",
      environment: options.environment ?? "Production",
      signedTransactionInfo: signAppleJws(transaction),
      status: 1,
    },
  };
  return { signedPayload: signAppleJws(payload) };
}

export const appStoreFixtures = (): Fixture[] => [
  { name: "trial started", body: appStoreNotification("SUBSCRIBED", "INITIAL_BUY", { trial: true }), expected: "trial_started" },
  { name: "subscribed", body: appStoreNotification("SUBSCRIBED", "INITIAL_BUY"), expected: "subscription_started" },
  { name: "resubscribed", body: appStoreNotification("SUBSCRIBED", "RESUBSCRIBE"), expected: "subscription_started" },
  // Apple reports a converted trial as a plain renewal
  { name: "renewed after trial", body: appStoreNotification("DID_RENEW", undefined), expected: "subscription_renewed" },
  { name: "billing recovered", body: appStoreNotification("DID_RENEW", "BILLING_RECOVERY"), expected: "subscription_renewed" },
  { name: "trial cancelled", body: appStoreNotification("DID_CHANGE_RENEWAL_STATUS", "AUTO_RENEW_DISABLED", { trial: true }), expected: "trial_cancelled" },
  { name: "cancelled", body: appStoreNotification("DID_CHANGE_RENEWAL_STATUS", "AUTO_RENEW_DISABLED"), expected: "subscription_cancelled" },
  { name: "uncancelled", body: appStoreNotification("DID_CHANGE_RENEWAL_STATUS", "AUTO_RENEW_ENABLED"), expected: "ignored" },
  { name: "billing issue", body: appStoreNotification("DID_FAIL_TO_RENEW", "GRACE_PERIOD"), expected: "billing_issue" },
  { name: "trial expired", body: appStoreNotification("EXPIRED", "VOLUNTARY", { trial: true }), expected: "trial_expired" },
  { name: "expired", body: appStoreNotification("EXPIRED", "BILLING_RETRY"), expected: "subscription_expired" },
  { name: "grace period over", body: appStoreNotification("GRACE_PERIOD_EXPIRED", undefined), expected: "subscription_expired" },
  { name: "refund", body: appStoreNotification("REFUND", undefined), expected: "refunded" },
  { name: "price increase", body: appStoreNotification("PRICE_INCREASE", "ACCEPTED"), expected: "ignored" },
  { name: "test", body: appStoreNotification("TEST", undefined), expected: "test" },
];
