import { randomBytes } from "node:crypto";

const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/** Uniform base62 string (rejection sampling, so no modulo bias). */
export function base62(length: number): string {
  let out = "";
  while (out.length < length) {
    for (const byte of randomBytes(length * 2)) {
      if (byte < 248) out += BASE62[byte % 62];
      if (out.length === length) break;
    }
  }
  return out;
}

/** Public App ID the SDK is configured with: `app_` + 22 base62 chars (~131 bits). */
export const newPublicAppId = () => `app_${base62(22)}`;

/** Identity-verification secret shown to the developer once and stored encrypted: `ids_` + 40 chars. */
export const newIdentitySecret = () => `ids_${base62(40)}`;

/** RFC 9562 UUIDv7: 48-bit Unix ms timestamp + random, so primary keys sort by creation time. */
export function uuidv7(now = Date.now()): string {
  const bytes = randomBytes(16);
  bytes.writeUIntBE(now, 0, 6);
  bytes[6] = (bytes[6]! & 0x0f) | 0x70;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
