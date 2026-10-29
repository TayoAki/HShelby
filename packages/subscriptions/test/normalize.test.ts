import { describe, expect, it } from "vitest";
import { JwsRejected, normalizeAdapty, normalizeAppStore, normalizeRevenueCat, normalizeSuperwall, type Normalized } from "../src";
import {
  adaptyFixtures,
  appStoreFixtures,
  appStoreNotification,
  revenueCatFixtures,
  signAppleJws,
  superwallFixtures,
  TEST_ROOTS,
  type Fixture,
} from "../src/testing";
import { checkSvixSignature, signSvix, SignatureRejected } from "../src/verify";

const outcome = (n: Normalized) => (n.kind === "event" ? n.event : n.kind);

/** Replaying each provider's fixture set yields the expected canonical events. */
describe.each([
  ["RevenueCat", revenueCatFixtures, (body: unknown) => normalizeRevenueCat(body, JSON.stringify(body))],
  ["Superwall", superwallFixtures, (body: unknown) => normalizeSuperwall(body, JSON.stringify(body))],
  ["Adapty", adaptyFixtures, (body: unknown) => normalizeAdapty(body, JSON.stringify(body))],
  ["App Store", appStoreFixtures, (body: unknown) => normalizeAppStore(body, { roots: TEST_ROOTS })],
] as const)("%s", (_name, fixtures: () => Fixture[], normalize: (body: unknown) => Normalized) => {
  it.each(fixtures().map((f) => [f.name, f] as const))("%s", (_n, fixture) => {
    expect(outcome(normalize(fixture.body))).toBe(fixture.expected);
  });
});

describe("matching IDs", () => {
  it("collects the IDs each provider knows the person by", () => {
    const rc = normalizeRevenueCat(revenueCatFixtures()[1]!.body, "");
    expect(rc.match.userIds).toEqual(["user-42", "$RCAnonymousID:8a6f"]);
    const asn = normalizeAppStore(appStoreNotification("DID_RENEW", undefined, { appAccountToken: "6F9619FF-8B86-D011-B42D-00C04FC964FF" }), { roots: TEST_ROOTS });
    expect(asn.match).toMatchObject({ originalTransactionId: "2000000800000001", appAccountToken: "6f9619ff-8b86-d011-b42d-00c04fc964ff" });
    expect(asn.bundleId).toBe("com.example.lockdlist");
    expect(asn.environment).toBe("production");
  });
});

describe("App Store signatures", () => {
  it("refuses notifications not signed by Apple's chain", () => {
    const body = appStoreNotification("DID_RENEW", undefined);
    // Apple's real root doesn't trust the test chain
    expect(() => normalizeAppStore(body)).toThrow(JwsRejected);
    // a payload swapped under a valid signature
    const [h, , s] = body.signedPayload.split(".");
    const forged = `${h}.${Buffer.from(JSON.stringify({ notificationType: "REFUND", notificationUUID: "x" })).toString("base64url")}.${s}`;
    expect(() => normalizeAppStore({ signedPayload: forged }, { roots: TEST_ROOTS })).toThrow("bad signature");
    // a chain of only two certificates
    const header = JSON.parse(Buffer.from(h!, "base64url").toString());
    const short = `${Buffer.from(JSON.stringify({ ...header, x5c: header.x5c.slice(0, 2) })).toString("base64url")}.${body.signedPayload.split(".")[1]}.${s}`;
    expect(() => normalizeAppStore({ signedPayload: short }, { roots: TEST_ROOTS })).toThrow(JwsRejected);
    expect(() => normalizeAppStore({ signedPayload: signAppleJws({}) }, { roots: TEST_ROOTS })).toThrow("not a notification");
  });
});

describe("Superwall signatures", () => {
  const secret = `whsec_${Buffer.from("a".repeat(32)).toString("base64")}`;
  it("accepts its own signature and refuses changes, old timestamps and other secrets", () => {
    const body = JSON.stringify({ type: "renewal" });
    const headers = signSvix(body, secret);
    const get = (h: Record<string, string>) => (name: string) => h[name];
    expect(checkSvixSignature(get(headers), body, secret)).toBe(headers["webhook-id"]);
    expect(() => checkSvixSignature(get(headers), `${body} `, secret)).toThrow(SignatureRejected);
    expect(() => checkSvixSignature(get(headers), body, `whsec_${Buffer.from("b".repeat(32)).toString("base64")}`)).toThrow(SignatureRejected);
    const old = signSvix(body, secret, "msg_1", Math.floor(Date.now() / 1000) - 600);
    expect(() => checkSvixSignature(get(old), body, secret)).toThrow("timestamp");
  });
});
