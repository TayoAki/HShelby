import { generateKeyPairSync, randomUUID, type KeyObject } from "node:crypto";
import http2 from "node:http2";
import type { AddressInfo } from "node:net";
import { jwtVerify } from "jose";

/** A fresh .p8-style key (P-256, PKCS#8 PEM) and its public half, for tests. */
export function generateP8() {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  return { p8: privateKey.export({ type: "pkcs8", format: "pem" }).toString(), publicKey };
}

export type FakeApnsRequest = {
  deviceToken: string;
  headers: http2.IncomingHttpHeaders;
  payload: { aps: Record<string, unknown> } & Record<string, unknown>;
};

/**
 * A local stand-in for APNs over cleartext HTTP/2. It records every request, answers 200 unless told
 * otherwise per device token, and, given the key's public half, rejects bad provider tokens like
 * Apple does (403 InvalidProviderToken).
 */
export async function startFakeApns(options: { verifyWith?: KeyObject; keyId?: string; teamId?: string } = {}) {
  const requests: FakeApnsRequest[] = [];
  const answers = new Map<string, { status: number; reason?: string }>();
  const server = http2.createServer();

  server.on("stream", (stream, headers) => {
    let body = "";
    stream.setEncoding("utf8");
    stream.on("data", (chunk: string) => (body += chunk));
    stream.on("end", async () => {
      const deviceToken = String(headers[":path"]).replace("/3/device/", "");
      requests.push({ deviceToken, headers, payload: JSON.parse(body || "{}") });
      let answer = answers.get(deviceToken) ?? { status: 200 };
      if (options.verifyWith) {
        const jwt = String(headers.authorization ?? "").replace(/^bearer /, "");
        try {
          const { protectedHeader, payload } = await jwtVerify(jwt, options.verifyWith, { algorithms: ["ES256"] });
          if ((options.keyId && protectedHeader.kid !== options.keyId) || (options.teamId && payload.iss !== options.teamId)) {
            throw new Error("wrong key or team");
          }
        } catch {
          answer = { status: 403, reason: "InvalidProviderToken" };
        }
      }
      stream.respond({ ":status": answer.status, "apns-id": randomUUID(), "content-type": "application/json" });
      stream.end(answer.status === 200 ? "" : JSON.stringify({ reason: answer.reason }));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    /** Answer this device token with an error from now on (status 200 restores success). */
    answer(deviceToken: string, status: number, reason?: string) {
      answers.set(deviceToken, { status, reason });
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
