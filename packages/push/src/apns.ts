import { createHash } from "node:crypto";
import http2 from "node:http2";
import type { PushEnvironment } from "@hshelby/contracts";
import { importPKCS8, SignJWT } from "jose";

/*
 * Apple Push Notification service over HTTP/2 with token auth: one .p8 key per app signs short-lived
 * ES256 provider tokens, and each device token goes to the sandbox or production host it was issued for.
 */

export const APNS_HOSTS: Record<PushEnvironment, string> = {
  sandbox: "https://api.sandbox.push.apple.com",
  production: "https://api.push.apple.com",
};

export type ApnsCredentials = { teamId: string; keyId: string; p8: string };

export type ApnsNotification = {
  deviceToken: string;
  /** The app's bundle ID. */
  topic: string;
  payload: object;
};

export type ApnsResult = { ok: true; status: number; apnsId: string | null } | { ok: false; status: number; reason: string };

/** Apple wants provider tokens refreshed when they're 20–60 minutes old. */
const PROVIDER_TOKEN_TTL_MS = 50 * 60_000;
/** How long APNs keeps trying an offline device. */
const EXPIRATION_SECONDS = 24 * 60 * 60;

/** Throws unless the PEM is a P-256 PKCS#8 private key, which is what Apple's .p8 files are. */
export async function assertValidP8(p8: string) {
  await importPKCS8(p8, "ES256");
}

export type ApnsClient = ReturnType<typeof createApnsClient>;

export function createApnsClient(options: { hosts?: Partial<Record<PushEnvironment, string>>; timeoutMs?: number } = {}) {
  const hosts = { ...APNS_HOSTS, ...options.hosts };
  const timeoutMs = options.timeoutMs ?? 10_000;
  const sessions = new Map<string, http2.ClientHttp2Session>();
  const providerTokens = new Map<string, { jwt: string; issuedAt: number }>();

  const tokenKey = (c: ApnsCredentials) => `${c.teamId}:${c.keyId}:${createHash("sha256").update(c.p8).digest("hex")}`;

  async function providerToken(credentials: ApnsCredentials) {
    const key = tokenKey(credentials);
    const cached = providerTokens.get(key);
    if (cached && Date.now() - cached.issuedAt < PROVIDER_TOKEN_TTL_MS) return cached.jwt;
    const jwt = await new SignJWT({})
      .setProtectedHeader({ alg: "ES256", kid: credentials.keyId })
      .setIssuer(credentials.teamId)
      .setIssuedAt()
      .sign(await importPKCS8(credentials.p8, "ES256"));
    providerTokens.set(key, { jwt, issuedAt: Date.now() });
    return jwt;
  }

  /** One long-lived HTTP/2 connection per host, as Apple recommends; a broken one is replaced on the next send. */
  function session(origin: string) {
    const existing = sessions.get(origin);
    if (existing && !existing.closed && !existing.destroyed) return existing;
    const created = http2.connect(origin);
    const forget = () => {
      if (sessions.get(origin) === created) sessions.delete(origin);
    };
    created.on("error", forget);
    created.on("goaway", forget);
    created.on("close", forget);
    created.unref();
    sessions.set(origin, created);
    return created;
  }

  async function send(credentials: ApnsCredentials, environment: PushEnvironment, notification: ApnsNotification): Promise<ApnsResult> {
    const jwt = await providerToken(credentials);
    const result = await new Promise<ApnsResult>((resolve) => {
      let settled = false;
      const finish = (r: ApnsResult) => {
        if (!settled) {
          settled = true;
          resolve(r);
        }
      };
      let request: http2.ClientHttp2Stream;
      try {
        request = session(hosts[environment]).request({
          ":method": "POST",
          ":path": `/3/device/${notification.deviceToken}`,
          authorization: `bearer ${jwt}`,
          "apns-topic": notification.topic,
          "apns-push-type": "alert",
          "apns-priority": "10",
          "apns-expiration": String(Math.floor(Date.now() / 1000) + EXPIRATION_SECONDS),
          "content-type": "application/json",
        });
      } catch {
        return finish({ ok: false, status: 0, reason: "ConnectionError" });
      }
      let status = 0;
      let apnsId: string | null = null;
      let body = "";
      request.setEncoding("utf8");
      request.setTimeout(timeoutMs, () => {
        request.close(http2.constants.NGHTTP2_CANCEL);
        finish({ ok: false, status: 0, reason: "Timeout" });
      });
      request.on("response", (headers) => {
        status = Number(headers[":status"]);
        apnsId = typeof headers["apns-id"] === "string" ? headers["apns-id"] : null;
      });
      request.on("data", (chunk: string) => (body += chunk));
      request.on("end", () => {
        if (status === 200) return finish({ ok: true, status, apnsId });
        let reason = `HTTP ${status}`;
        try {
          reason = (JSON.parse(body) as { reason?: string }).reason ?? reason;
        } catch {
          // keep the status as the reason
        }
        finish({ ok: false, status, reason });
      });
      request.on("error", () => finish({ ok: false, status: 0, reason: "ConnectionError" }));
      request.end(JSON.stringify(notification.payload));
    });
    // Our token aged out on Apple's side: sign a fresh one for the retry.
    if (!result.ok && result.reason === "ExpiredProviderToken") providerTokens.delete(tokenKey(credentials));
    return result;
  }

  function close() {
    for (const s of sessions.values()) s.close();
    sessions.clear();
  }

  return { send, close };
}

/** What an APNs answer means for us. */
export type PushOutcome = "delivered" | "token_gone" | "device_issue" | "config_issue" | "retry";

const CONFIG_REASONS = new Set(["BadTopic", "TopicDisallowed", "MissingTopic", "BadCertificate", "BadCertificateEnvironment"]);

export function classify(result: ApnsResult): PushOutcome {
  if (result.ok) return "delivered";
  // Unregistered / ExpiredToken: the app was removed or the token rotated.
  if (result.status === 410) return "token_gone";
  if (result.status === 0 || result.status === 429 || result.status >= 500 || result.reason === "ExpiredProviderToken") {
    return "retry";
  }
  // InvalidProviderToken, MissingProviderToken, Forbidden: the key, Key ID or Team ID is wrong.
  if (result.status === 403 || CONFIG_REASONS.has(result.reason)) return "config_issue";
  // BadDeviceToken (often a sandbox token sent to production, or the reverse), DeviceTokenNotForTopic, …
  return "device_issue";
}
