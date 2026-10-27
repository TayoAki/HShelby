import { describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";
import {
  base62,
  buildSetupPrompt,
  createAppStoreClient,
  decryptSecret,
  encryptSecret,
  newIdentitySecret,
  newPublicAppId,
  parseAppStoreId,
  parseKeyring,
  uuidv7,
} from "../src";

const key = () => randomBytes(32).toString("base64");

describe("ids", () => {
  it("makes App IDs and identity secrets in the documented shape", () => {
    expect(newPublicAppId()).toMatch(/^app_[0-9A-Za-z]{22}$/);
    expect(newIdentitySecret()).toMatch(/^ids_[0-9A-Za-z]{40}$/);
    expect(new Set(Array.from({ length: 1000 }, () => base62(8))).size).toBe(1000);
  });

  it("makes time-ordered UUIDv7s", () => {
    const a = uuidv7(1_700_000_000_000);
    const b = uuidv7(1_700_000_000_001);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(a < b).toBe(true);
  });
});

describe("secret encryption", () => {
  it("round-trips and decrypts with older keys after rotation", () => {
    const k1 = key();
    const old = encryptSecret("ids_secret", parseKeyring(`v1:${k1}`));
    expect(old.startsWith("v1:")).toBe(true);
    expect(old).not.toContain("ids_secret");
    const rotated = parseKeyring(`v1:${k1},v2:${key()}`);
    expect(decryptSecret(old, rotated)).toBe("ids_secret");
    expect(encryptSecret("x", rotated).startsWith("v2:")).toBe(true);
  });

  it("rejects tampered ciphertext", () => {
    const ring = parseKeyring(`v1:${key()}`);
    const env = encryptSecret("ids_secret", ring);
    const tampered = env.slice(0, -2) + (env.endsWith("A") ? "BB" : "AA");
    expect(() => decryptSecret(tampered, ring)).toThrow();
  });

  it("rejects malformed keyrings", () => {
    expect(() => parseKeyring("")).toThrow();
    expect(() => parseKeyring("v1:short")).toThrow();
  });
});

describe("App Store", () => {
  it("parses IDs from links and bare numbers", () => {
    expect(parseAppStoreId("570060128")).toBe("570060128");
    expect(parseAppStoreId("https://apps.apple.com/us/app/duolingo-learn-languages/id570060128?uo=4")).toBe("570060128");
    expect(parseAppStoreId("apps.apple.com/app/id6741")).toBeNull();
    expect(parseAppStoreId("Duolingo")).toBeNull();
  });

  it("maps search results and turns links into lookups", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const body = String(url).includes("/lookup")
        ? { results: [{ trackId: 570060128, trackName: "Duolingo", bundleId: "com.duolingo", trackViewUrl: "https://apps.apple.com/us/app/x/id570060128?uo=4" }] }
        : { results: [{ trackId: 1, trackName: "A" }, { trackName: "missing id" }] };
      return new Response(JSON.stringify(body));
    });
    const client = createAppStoreClient({ fetch: fetchMock as typeof fetch });
    expect(await client.search("anything")).toHaveLength(1);
    const [app] = await client.search("https://apps.apple.com/us/app/x/id570060128");
    expect(app).toMatchObject({ appStoreId: "570060128", bundleId: "com.duolingo", url: "https://apps.apple.com/us/app/x/id570060128" });
    await client.search("anything");
    expect(fetchMock).toHaveBeenCalledTimes(2); // second identical search is cached
  });
});

describe("setup prompt", () => {
  it("includes the App ID and flags missing packages instead of guessing", () => {
    const prompt = buildSetupPrompt({ appName: "LockdList", publicId: "app_0123456789012345678901", apiBaseUrl: "https://api.example.com" });
    expect(prompt).toContain("App ID: app_0123456789012345678901");
    expect(prompt).toContain("<SWIFT_PACKAGE_URL>");
    expect(prompt).toContain("not published yet");
  });
});
