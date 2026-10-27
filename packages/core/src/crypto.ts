import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/*
 * Envelope format for secrets at rest: `<keyId>:<base64url(iv | ciphertext | tag)>`, AES-256-GCM.
 * The keyring comes from ENC_KEYS="v1:<base64 32 bytes>,v2:<…>"; the last entry encrypts,
 * every entry can decrypt, so keys rotate without rewriting old rows first.
 */

export type Keyring = { currentId: string; keys: Map<string, Buffer> };

export function parseKeyring(spec: string): Keyring {
  const keys = new Map<string, Buffer>();
  let currentId = "";
  for (const part of spec.split(",").map((s) => s.trim()).filter(Boolean)) {
    const sep = part.indexOf(":");
    if (sep <= 0) throw new Error("ENC_KEYS entries must look like <id>:<base64 key>");
    const id = part.slice(0, sep);
    const key = Buffer.from(part.slice(sep + 1), "base64");
    if (key.length !== 32) throw new Error(`ENC_KEYS key "${id}" must be 32 bytes (base64)`);
    keys.set(id, key);
    currentId = id;
  }
  if (!currentId) throw new Error("ENC_KEYS is empty");
  return { currentId, keys };
}

export function encryptSecret(plaintext: string, keyring: Keyring): string {
  const key = keyring.keys.get(keyring.currentId)!;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(keyring.currentId));
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return `${keyring.currentId}:${Buffer.concat([iv, body, cipher.getAuthTag()]).toString("base64url")}`;
}

export function decryptSecret(envelope: string, keyring: Keyring): string {
  const sep = envelope.indexOf(":");
  const id = envelope.slice(0, sep);
  const key = keyring.keys.get(id);
  if (!key) throw new Error(`no key "${id}" in ENC_KEYS`);
  const raw = Buffer.from(envelope.slice(sep + 1), "base64url");
  const decipher = createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12));
  decipher.setAAD(Buffer.from(id));
  decipher.setAuthTag(raw.subarray(raw.length - 16));
  return Buffer.concat([decipher.update(raw.subarray(12, raw.length - 16)), decipher.final()]).toString("utf8");
}
