import {
  IDENTITY_LIMITS,
  STICKY_METADATA_KEYS,
  type IdentityLabels,
  type Metadata,
  type SdkIdentity,
  type SdkSending,
} from "@hshelby/contracts";
import type { devices } from "@hshelby/db";
import { errors, jwtVerify } from "jose";
import { ApiError } from "./errors";

type DeviceRow = typeof devices.$inferSelect;

export type IdentityClaims = { userId: string; name: string | null; email: string | null; exp: number };

/** Allows for clock drift between the developer's server and ours on `exp` and `nbf`. */
const CLOCK_TOLERANCE_SECONDS = 30;

const invalid = (why: string) => new ApiError(422, "identity_token_invalid", `Identity token rejected: ${why}`);

/** A claim kept only when it's a non-empty string within its limit; otherwise ignored, not fatal. */
const optionalText = (value: unknown, max: number) =>
  typeof value === "string" && value.trim() && value.trim().length <= max ? value.trim() : null;

/**
 * Verifies an identity token from the developer's server: HS256 only, keyed with the app's `ids_…`
 * secret used verbatim (prefix included). `user_id` (a string up to 255 characters or a safe integer)
 * and `exp` are required, a future `nbf` is refused, `name` and `email` are optional, and every other
 * claim is ignored.
 */
export async function verifyIdentityToken(secret: string, token: string): Promise<IdentityClaims> {
  if (token.startsWith("ids_")) {
    throw invalid("this is the identity secret, not a token. Sign tokens with it on your server and never put it in the app");
  }
  if (token.length > IDENTITY_LIMITS.token) throw invalid(`longer than ${IDENTITY_LIMITS.token} characters`);

  let payload;
  try {
    ({ payload } = await jwtVerify(token, new TextEncoder().encode(secret), {
      algorithms: ["HS256"],
      requiredClaims: ["exp"],
      clockTolerance: CLOCK_TOLERANCE_SECONDS,
    }));
  } catch (err) {
    if (err instanceof errors.JWTExpired) {
      throw new ApiError(422, "identity_token_expired", "Identity token expired; fetch a fresh one from your server");
    }
    if (err instanceof errors.JWTClaimValidationFailed) {
      throw invalid(`the "${err.claim}" claim ${err.reason === "missing" ? "is missing" : "is not valid yet or malformed"}`);
    }
    throw invalid("not an HS256 token signed with this app's identity secret");
  }

  const raw = payload.user_id;
  const userId = typeof raw === "string" ? raw.trim() : typeof raw === "number" && Number.isSafeInteger(raw) ? String(raw) : "";
  if (!userId) {
    throw invalid(payload.sub !== undefined ? `"user_id" is missing (the token has "sub"; use "user_id")` : `"user_id" is missing`);
  }
  if (userId.length > IDENTITY_LIMITS.userId) throw invalid(`"user_id" is longer than ${IDENTITY_LIMITS.userId} characters`);

  return {
    userId,
    name: optionalText(payload.name, IDENTITY_LIMITS.name),
    email: optionalText(payload.email, IDENTITY_LIMITS.email),
    exp: payload.exp!,
  };
}

/**
 * The identity columns to write after applying labels and/or verified claims:
 * - a different user ID for a device that already has one is `identity_mismatch`: the app must log out
 *   first, so one user's history never shows up for another;
 * - verified claims replace the identity (a verified device shows exactly its latest token's claims);
 * - labels fill in fields on an unverified device and never touch a verified one.
 */
export function nextIdentity(
  device: Pick<DeviceRow, "userIdExt" | "verified">,
  labels: IdentityLabels | undefined,
  claims: IdentityClaims | null,
): Partial<DeviceRow> {
  const incoming = claims?.userId ?? labels?.userId;
  if (device.userIdExt && incoming && incoming !== device.userIdExt) {
    throw new ApiError(409, "identity_mismatch", "This device belongs to another user. Log out first, then identify the new user.");
  }
  if (claims) {
    return {
      userIdExt: claims.userId,
      name: claims.name,
      email: claims.email,
      verified: true,
      verifiedAt: new Date(),
      verifiedClaims: { user_id: claims.userId, name: claims.name, email: claims.email, exp: claims.exp },
    };
  }
  if (!labels || device.verified) return {};
  return {
    ...(labels.userId && { userIdExt: labels.userId }),
    ...(labels.name && { name: labels.name }),
    ...(labels.email && { email: labels.email }),
  };
}

/** setMetadata() replaces everything, except that provider IDs the update omits keep their last value. */
export function nextMetadata(current: Record<string, string>, update: Metadata): Record<string, string> {
  const next = { ...update };
  for (const key of STICKY_METADATA_KEYS) {
    if (!(key in next) && current[key] !== undefined) next[key] = current[key];
  }
  return next;
}

export const toSdkIdentity = (d: Pick<DeviceRow, "userIdExt" | "name" | "email" | "verified">): SdkIdentity => ({
  userId: d.userIdExt,
  name: d.name,
  email: d.email,
  verified: d.verified,
});

export function sendingState(device: Pick<DeviceRow, "blocked" | "verified">, onlyVerified: boolean): SdkSending {
  if (device.blocked) return { allowed: false, reason: "device_blocked" };
  if (onlyVerified && !device.verified) return { allowed: false, reason: "verification_required" };
  return { allowed: true, reason: null };
}
