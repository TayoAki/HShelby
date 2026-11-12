import { createHash, timingSafeEqual } from "node:crypto";
import { brand } from "@hshelby/contracts";

/*
 * Partners (app builders) that create Hire Shelby apps for their users through the partner API. They're
 * configured in PARTNERS as `id:key` pairs; each gets a service account (an address under PARTNER_EMAIL_DOMAIN that
 * nobody can sign in with) that sends the owners' invitations, so the dashboard and sign-up treat them as usual.
 */

export type Partner = { id: string; name: string };

/** Partners' service accounts live here; invitations from them are the partner's. */
export const PARTNER_EMAIL_DOMAIN = `partners.${brand.domain}`;

const ID = /^[a-z0-9][a-z0-9-]{1,39}$/;

/** "app-builder" → "App Builder". */
export const partnerName = (id: string) =>
  id
    .split("-")
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join(" ");

const digest = (key: string) => createHash("sha256").update(key).digest();

/** Parses PARTNERS. Throws on a malformed entry, so a typo fails at startup rather than locking a partner out. */
export function parsePartners(value: string | undefined) {
  const partners: { partner: Partner; digest: Buffer }[] = [];
  for (const entry of (value ?? "").split(",").map((s) => s.trim()).filter(Boolean)) {
    const at = entry.indexOf(":");
    const id = entry.slice(0, at);
    const key = entry.slice(at + 1);
    if (at < 0 || !ID.test(id)) throw new Error("PARTNERS: each entry is id:key, with a lowercase slug id like app-builder");
    if (key.length < 32) throw new Error(`PARTNERS: the key for ${id} must be at least 32 characters (openssl rand -hex 32)`);
    if (partners.some((p) => p.partner.id === id)) throw new Error(`PARTNERS: ${id} appears twice`);
    partners.push({ partner: { id, name: partnerName(id) }, digest: digest(key) });
  }
  /** The partner a presented key belongs to; compares digests in constant time. */
  return (key: string | undefined): Partner | null => {
    if (!key) return null;
    const presented = digest(key);
    let found: Partner | null = null;
    for (const p of partners) if (timingSafeEqual(presented, p.digest)) found = p.partner;
    return found;
  };
}

export const partnerServiceEmail = (partner: Partner) => `${partner.id}@${PARTNER_EMAIL_DOMAIN}`;
