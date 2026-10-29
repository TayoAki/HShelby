import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/* Webhook authentication for the providers that use secrets. */

export class SignatureRejected extends Error {}

/** A value for the provider's Authorization header (RevenueCat, Adapty): we generate it, the customer pastes it there. */
export const newAuthorizationValue = () => `Bearer ${randomBytes(24).toString("base64url")}`;

const same = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

export function checkAuthorization(header: string | undefined, expected: string) {
  if (!header || !same(header.trim(), expected)) throw new SignatureRejected("wrong Authorization header");
}

/**
 * Superwall signs webhooks the Svix way: `v1,<base64 HMAC-SHA256>` over `<id>.<timestamp>.<body>` with the
 * base64 key after `whsec_`, headers `webhook-*` (or `svix-*`). Timestamps more than 5 minutes off are refused.
 */
export function checkSvixSignature(headers: (name: string) => string | undefined, body: string, secret: string, now = Date.now()) {
  const id = headers("webhook-id") ?? headers("svix-id");
  const timestamp = headers("webhook-timestamp") ?? headers("svix-timestamp");
  const signatures = headers("webhook-signature") ?? headers("svix-signature");
  if (!id || !timestamp || !signatures) throw new SignatureRejected("missing signature headers");
  if (!/^\d+$/.test(timestamp) || Math.abs(now / 1000 - Number(timestamp)) > 300) throw new SignatureRejected("timestamp too old or in the future");
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest("base64");
  const ok = signatures.split(" ").some((part) => {
    const [version, sig] = part.split(",");
    return version === "v1" && sig !== undefined && same(sig, expected);
  });
  if (!ok) throw new SignatureRejected("bad signature");
  return id;
}

/** For tests and the fake: headers Superwall would send. */
export function signSvix(body: string, secret: string, id = `msg_${randomBytes(8).toString("hex")}`, timestamp = Math.floor(Date.now() / 1000)) {
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const sig = createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest("base64");
  return { "webhook-id": id, "webhook-timestamp": String(timestamp), "webhook-signature": `v1,${sig}` };
}
