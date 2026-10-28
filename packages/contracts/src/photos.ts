import { z } from "zod";

export const PHOTO_LIMITS = {
  bytes: 1024 * 1024,
  /** Longest side, in pixels. */
  pixels: 2048,
  perMessage: 4,
  /** Uploads a device may hold that haven't been sent yet. */
  unsentPerDevice: 20,
} as const;

export const PhotoType = z.enum(["image/jpeg", "image/png"]);
export type PhotoType = z.infer<typeof PhotoType>;

const side = z.number().int().min(1).max(PHOTO_LIMITS.pixels);

/** `POST /v1/uploads`: what the SDK is about to upload, after resizing and applying EXIF orientation. */
export const UploadRequest = z
  .object({
    contentType: PhotoType,
    bytes: z.number().int().min(1).max(PHOTO_LIMITS.bytes),
    width: side,
    height: side,
    /** Base64 SHA-256 of the exact bytes. */
    checksum: z.string().regex(/^[A-Za-z0-9+/]{43}=$/, "must be the base64 SHA-256 of the file"),
  })
  .strict();
export type UploadRequest = z.infer<typeof UploadRequest>;

/** Where to PUT the file. The upload only counts once a message is sent with `attachmentId`. */
export const UploadTicket = z.object({
  attachmentId: z.string(),
  uploadUrl: z.string(),
  method: z.literal("PUT"),
  headers: z.record(z.string(), z.string()),
  expiresIn: z.number().int(),
});
export type UploadTicket = z.infer<typeof UploadTicket>;

/** A photo on a message. `url` is a signed link that works for 15 minutes; fetch the thread again for a fresh one. */
export const Attachment = z.object({
  id: z.string(),
  url: z.string(),
  contentType: PhotoType,
  width: z.number().int(),
  height: z.number().int(),
});
export type Attachment = z.infer<typeof Attachment>;
