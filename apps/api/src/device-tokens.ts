import { createHash, hkdfSync } from "node:crypto";
import { jwtVerify, SignJWT } from "jose";

/*
 * SDK auth: registration hands the device a long-lived secret (Keychain) and a 15-minute HS256 access token.
 * The token carries the device's session version; logout and data deletion (phase B4) bump it, so outstanding
 * tokens stop working even before they expire.
 */

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
const AUDIENCE = "sdk";

/** Device tokens get their own key, derived from the server secret, so they never share one with auth cookies. */
export const deriveDeviceTokenKey = (serverSecret: string) =>
  new Uint8Array(hkdfSync("sha256", serverSecret, new Uint8Array(0), "hshelby device access token v1", 32));

export const hashDeviceSecret = (secret: string) => createHash("sha256").update(secret).digest("hex");

export type AccessClaims = { deviceId: string; appId: string; sessionVersion: number };

export async function signAccessToken(key: Uint8Array, claims: AccessClaims) {
  const accessToken = await new SignJWT({ app: claims.appId, sv: claims.sessionVersion })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(claims.deviceId)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TOKEN_TTL_SECONDS}s`)
    .sign(key);
  return { accessToken, expiresIn: ACCESS_TOKEN_TTL_SECONDS };
}

/** Null for anything but a valid, unexpired token we signed. */
export async function verifyAccessToken(key: Uint8Array, token: string): Promise<AccessClaims | null> {
  try {
    const { payload } = await jwtVerify(token, key, {
      algorithms: ["HS256"],
      audience: AUDIENCE,
      requiredClaims: ["sub", "exp"],
    });
    if (typeof payload.sub !== "string" || typeof payload.app !== "string" || typeof payload.sv !== "number") return null;
    return { deviceId: payload.sub, appId: payload.app, sessionVersion: payload.sv };
  } catch {
    return null;
  }
}
