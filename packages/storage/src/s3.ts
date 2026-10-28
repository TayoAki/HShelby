import { DeleteObjectCommand, GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/*
 * Private S3-compatible object storage (Railway Buckets, R2, S3). Clients upload and download with
 * short-lived presigned URLs; the server never trusts an upload until it has read it back itself.
 */

export type StorageConfig = {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Path-style URLs (`endpoint/bucket/key`) instead of virtual-hosted (`bucket.endpoint/key`). */
  forcePathStyle: boolean;
};

type StorageEnv = Partial<
  Record<"S3_ENDPOINT" | "S3_REGION" | "S3_BUCKET" | "S3_ACCESS_KEY_ID" | "S3_SECRET_ACCESS_KEY" | "S3_FORCE_PATH_STYLE", string>
>;

/** Photos are off unless endpoint, bucket and both keys are set. */
export function storageConfigFromEnv(env: StorageEnv): StorageConfig | null {
  const { S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY } = env;
  if (!S3_ENDPOINT || !S3_BUCKET || !S3_ACCESS_KEY_ID || !S3_SECRET_ACCESS_KEY) return null;
  return {
    endpoint: S3_ENDPOINT,
    region: env.S3_REGION || "auto",
    bucket: S3_BUCKET,
    accessKeyId: S3_ACCESS_KEY_ID,
    secretAccessKey: S3_SECRET_ACCESS_KEY,
    forcePathStyle: env.S3_FORCE_PATH_STYLE === "true",
  };
}

const notFound = (err: unknown) => {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e.name === "NoSuchKey" || e.name === "NotFound" || e.$metadata?.httpStatusCode === 404;
};

/** Runs `task` over `items`, at most `limit` at a time. */
async function eachLimited<T>(items: T[], limit: number, task: (item: T) => Promise<void>) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) await task(items[next++]!);
    }),
  );
}

export type Storage = ReturnType<typeof createStorage>;

export function createStorage(config: StorageConfig) {
  const s3 = new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: config.forcePathStyle,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    // the SDK's default extra checksums break presigned URLs on S3-compatible providers
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
  const Bucket = config.bucket;

  /** Deletes keys one by one (single-object delete is what every S3-compatible provider supports). */
  async function deleteKeys(keys: string[]) {
    await eachLimited(keys, 8, async (Key) => {
      await s3.send(new DeleteObjectCommand({ Bucket, Key }));
    });
  }

  return {
    /**
     * A URL the client PUTs the file to. Content type, length and SHA-256 are part of the signature, so
     * providers that check them refuse anything else; the server verifies the bytes either way.
     */
    async presignUpload(input: { key: string; contentType: string; bytes: number; sha256: string; expiresIn: number }) {
      const url = await getSignedUrl(
        s3,
        new PutObjectCommand({
          Bucket,
          Key: input.key,
          ContentType: input.contentType,
          ContentLength: input.bytes,
          ChecksumSHA256: input.sha256,
        }),
        { expiresIn: input.expiresIn, signableHeaders: new Set(["content-type", "content-length"]) },
      );
      return { url, headers: { "content-type": input.contentType } };
    },

    /** A GET link. `contentType` overrides the type stored with the object, which the uploader chose. */
    presignDownload: (key: string, expiresIn: number, contentType?: string) =>
      getSignedUrl(s3, new GetObjectCommand({ Bucket, Key: key, ResponseContentType: contentType }), { expiresIn }),

    /** The object's bytes, at most `maxBytes + 1` of them (so an oversized object shows as such), or null if it's missing. */
    async read(key: string, maxBytes: number): Promise<Buffer | null> {
      try {
        const res = await s3.send(new GetObjectCommand({ Bucket, Key: key, Range: `bytes=0-${maxBytes}` }));
        return Buffer.from(await res.Body!.transformToByteArray());
      } catch (err) {
        if (notFound(err)) return null;
        throw err;
      }
    },

    async put(key: string, body: Buffer, contentType: string) {
      await s3.send(new PutObjectCommand({ Bucket, Key: key, Body: body, ContentType: contentType }));
    },

    deleteKeys,

    /** Deletes every object under `prefix`; returns how many there were. */
    async deletePrefix(prefix: string) {
      let deleted = 0;
      let token: string | undefined;
      do {
        const page = await s3.send(new ListObjectsV2Command({ Bucket, Prefix: prefix, ContinuationToken: token }));
        const keys = (page.Contents ?? []).map((o) => o.Key!).filter(Boolean);
        await deleteKeys(keys);
        deleted += keys.length;
        token = page.IsTruncated ? page.NextContinuationToken : undefined;
      } while (token);
      return deleted;
    },

    close: () => s3.destroy(),
  };
}
