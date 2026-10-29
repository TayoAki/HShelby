import { verify, X509Certificate } from "node:crypto";
import { APPLE_ROOT_CA_G3_PEM } from "./fixtures/apple-root";

/*
 * App Store Server Notifications v2 arrive as a JWS whose header carries the signing certificate chain (x5c).
 * Trust comes from the chain ending at Apple's root, Apple's marker extensions on the intermediate and the
 * signing certificate, and the ES256 signature over the JWS. No shared secret is involved.
 */

export class JwsRejected extends Error {}

/** DER of the extension OIDs Apple puts on its WWDR intermediate (…6.2.1) and its signing certificate (…6.11.1). */
const OID_INTERMEDIATE = Buffer.from("060a2a864886f76364060201", "hex");
const OID_SIGNING = Buffer.from("060a2a864886f76364060b01", "hex");

const b64url = (s: string) => Buffer.from(s, "base64url");

export type JwsOptions = {
  /** Trusted roots; Apple Root CA - G3 unless a test passes its own. */
  roots?: string[];
  now?: Date;
};

/** Verifies an Apple-signed JWS and returns its payload. */
export function verifyAppleJws<T = Record<string, unknown>>(jws: string, options: JwsOptions = {}): T {
  const parts = jws.split(".");
  if (parts.length !== 3) throw new JwsRejected("not a JWS");
  const [h, p, s] = parts as [string, string, string];
  let header: { alg?: string; x5c?: string[] };
  try {
    header = JSON.parse(b64url(h).toString("utf8"));
  } catch {
    throw new JwsRejected("unreadable header");
  }
  if (header.alg !== "ES256") throw new JwsRejected("unexpected algorithm");
  if (!Array.isArray(header.x5c) || header.x5c.length !== 3) throw new JwsRejected("expected a three-certificate chain");

  let leaf: X509Certificate, intermediate: X509Certificate, root: X509Certificate;
  try {
    [leaf, intermediate, root] = header.x5c.map((c) => new X509Certificate(Buffer.from(c, "base64"))) as [X509Certificate, X509Certificate, X509Certificate];
  } catch {
    throw new JwsRejected("unreadable certificate");
  }
  const trusted = (options.roots ?? [APPLE_ROOT_CA_G3_PEM]).map((pem) => new X509Certificate(pem));
  if (!trusted.some((t) => t.fingerprint256 === root.fingerprint256)) throw new JwsRejected("chain doesn't end at a trusted root");
  if (!intermediate.checkIssued(root) || !intermediate.verify(root.publicKey)) throw new JwsRejected("intermediate not issued by the root");
  if (!leaf.checkIssued(intermediate) || !leaf.verify(intermediate.publicKey)) throw new JwsRejected("certificate not issued by the intermediate");
  if (!intermediate.ca || !intermediate.raw.includes(OID_INTERMEDIATE)) throw new JwsRejected("intermediate isn't Apple's WWDR certificate");
  if (!leaf.raw.includes(OID_SIGNING)) throw new JwsRejected("certificate isn't an App Store signing certificate");
  const now = options.now ?? new Date();
  for (const cert of [leaf, intermediate, root]) {
    if (now < new Date(cert.validFrom) || now > new Date(cert.validTo)) throw new JwsRejected("certificate outside its validity");
  }
  const signed = Buffer.from(`${h}.${p}`);
  if (!verify("sha256", signed, { key: leaf.publicKey, dsaEncoding: "ieee-p1363" }, b64url(s))) throw new JwsRejected("bad signature");
  try {
    return JSON.parse(b64url(p).toString("utf8")) as T;
  } catch {
    throw new JwsRejected("unreadable payload");
  }
}
