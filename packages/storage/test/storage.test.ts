import { createHash } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { inspectImage } from "../src";
import { jpegBytes, pngBytes, testStorage } from "../src/testing";

const { storage } = await testStorage();
afterAll(() => storage.close());

describe("inspectImage", () => {
  it("reads PNG and JPEG sizes from their headers", () => {
    expect(inspectImage(pngBytes(1170, 2532))).toEqual({ contentType: "image/png", width: 1170, height: 2532 });
    expect(inspectImage(jpegBytes(2048, 1536))).toEqual({ contentType: "image/jpeg", width: 2048, height: 1536 });
  });

  it("skips JPEG segments before the frame header", () => {
    const exif = Buffer.from([0xff, 0xe1, 0x00, 0x08, 1, 2, 3, 4, 5, 6]);
    const jpeg = jpegBytes(640, 480);
    const withExif = Buffer.concat([jpeg.subarray(0, 2), exif, jpeg.subarray(2)]);
    expect(inspectImage(withExif)).toEqual({ contentType: "image/jpeg", width: 640, height: 480 });
  });

  it("refuses anything else", () => {
    expect(inspectImage(Buffer.from("GIF89a................................"))).toBeNull();
    expect(inspectImage(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>"))).toBeNull();
    expect(inspectImage(pngBytes(0, 10))).toBeNull();
    expect(inspectImage(Buffer.from([0xff, 0xd8, 0xff]))).toBeNull();
  });
});

describe("storage", () => {
  it("takes an upload through a presigned URL and hands it back", async () => {
    const body = pngBytes(10, 10, 200);
    const sha256 = createHash("sha256").update(body).digest("base64");
    const { url, headers } = await storage.presignUpload({ key: "apps/a/one.png", contentType: "image/png", bytes: body.length, sha256, expiresIn: 60 });
    expect((await fetch(url, { method: "PUT", body, headers })).status).toBe(200);

    expect((await storage.read("apps/a/one.png", 1024))!.equals(body)).toBe(true);
    // reads stop one byte past the limit, so oversized objects are recognizable
    expect((await storage.read("apps/a/one.png", 50))!.length).toBe(51);
    expect(await storage.read("apps/a/missing.png", 1024)).toBeNull();

    const download = await storage.presignDownload("apps/a/one.png", 60);
    expect(Buffer.from(await (await fetch(download)).arrayBuffer()).equals(body)).toBe(true);
  });

  it("deletes keys and whole prefixes", async () => {
    for (const key of ["apps/b/devices/d1/1", "apps/b/devices/d1/2", "apps/b/devices/d2/1", "apps/c/1"]) {
      await storage.put(key, Buffer.from(key), "text/plain");
    }
    expect(await storage.deletePrefix("apps/b/devices/d1/")).toBe(2);
    expect(await storage.read("apps/b/devices/d1/1", 10)).toBeNull();
    expect(await storage.read("apps/b/devices/d2/1", 100)).not.toBeNull();
    await storage.deleteKeys(["apps/c/1"]);
    expect(await storage.read("apps/c/1", 10)).toBeNull();
  });
});
