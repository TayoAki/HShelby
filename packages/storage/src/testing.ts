import { randomUUID } from "node:crypto";
import { CreateBucketCommand, S3Client } from "@aws-sdk/client-s3";
import { createStorage, type StorageConfig } from "./s3";

/**
 * A fresh bucket on the test S3 server (moto in CI: `moto_server -p 5070`), so test files don't see each
 * other's objects. Set TEST_S3_ENDPOINT to use another server.
 */
export async function testStorage() {
  const config: StorageConfig = {
    endpoint: process.env.TEST_S3_ENDPOINT ?? "http://127.0.0.1:5070",
    region: "us-east-1",
    bucket: `test-${randomUUID()}`,
    accessKeyId: "test",
    secretAccessKey: "test",
    forcePathStyle: true,
  };
  const admin = new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: true,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
  });
  await admin.send(new CreateBucketCommand({ Bucket: config.bucket }));
  admin.destroy();
  return { config, storage: createStorage(config) };
}

/** Bytes that start like a PNG of the given size (header only, padded to `bytes`). */
export function pngBytes(width: number, height: number, bytes = 64) {
  const b = Buffer.alloc(Math.max(bytes, 33));
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write("IHDR", 12, "ascii");
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  return b;
}

/** Bytes that start like a JPEG of the given size (APP0 then a baseline frame header, padded to `bytes`). */
export function jpegBytes(width: number, height: number, bytes = 64) {
  const header = Buffer.from([
    0xff, 0xd8, // SOI
    0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, // APP0
    0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x03, // SOF0
  ]);
  const b = Buffer.alloc(Math.max(bytes, header.length));
  header.copy(b, 0);
  return b;
}
