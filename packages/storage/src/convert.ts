import sharp from "sharp";

/*
 * Server-side image conversion with sharp: asset-library images and teammates' profile photos. Kept out of the
 * package's main entry, so only the API loads the native library.
 */

export type ConvertedImage = { body: Buffer; width: number; height: number; contentType: "image/png" | "image/jpeg" };

export class ImageRejected extends Error {}

const startsWith = (b: Buffer, bytes: number[]) => bytes.every((v, i) => b[i] === v);

/** What an upload really is, by its first bytes (and for SVG, its markup), whatever it claims to be. */
export function sniffImage(b: Buffer): "png" | "jpeg" | "webp" | "svg" | null {
  if (startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  if (startsWith(b, [0xff, 0xd8, 0xff])) return "jpeg";
  if (b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP") return "webp";
  const head = b.subarray(0, 1024).toString("utf8").replace(/^﻿/, "").trimStart();
  if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(head)) return "svg";
  return null;
}

/**
 * Refuses SVG features that could reach outside the image when rendered: scripts, external references,
 * entity declarations (XXE) and embedded foreign content.
 */
function assertSafeSvg(svg: string) {
  if (/<!ENTITY|<!DOCTYPE|<script|<foreignObject|\bon\w+\s*=|(?:xlink:)?href\s*=\s*["'](?!#|data:image\/(?:png|jpeg|webp);)/i.test(svg)) {
    throw new ImageRejected("This SVG references outside content or scripts; export it as a plain SVG or PNG");
  }
}

/**
 * An asset-library image: SVG, PNG, JPEG or WebP in; a transparent PNG at most `maxSide` pixels on its longest
 * side out (iOS can't draw SVG from a URL). Vectors are rendered at the full size; bitmaps are never enlarged.
 */
export async function toAssetPng(input: Buffer, maxSide = 512): Promise<ConvertedImage> {
  const kind = sniffImage(input);
  if (!kind) throw new ImageRejected("Upload an SVG, PNG, JPEG or WebP image");
  if (kind === "svg") assertSafeSvg(input.toString("utf8"));
  try {
    const image = sharp(input, { density: kind === "svg" ? 300 : undefined, limitInputPixels: 40_000_000, failOn: "error" });
    const { data, info } = await image
      .rotate()
      .resize(maxSide, maxSide, { fit: "inside", withoutEnlargement: kind !== "svg" })
      .png({ compressionLevel: 9 })
      .toBuffer({ resolveWithObject: true });
    return { body: data, width: info.width, height: info.height, contentType: "image/png" };
  } catch (err) {
    if (err instanceof ImageRejected) throw err;
    throw new ImageRejected("This image couldn't be read");
  }
}

/** A teammate's profile photo: oriented, cropped square, 256 px, JPEG without metadata. */
export async function toProfilePhoto(input: Buffer, side = 256): Promise<ConvertedImage> {
  const kind = sniffImage(input);
  if (!kind || kind === "svg") throw new ImageRejected("Upload a PNG, JPEG or WebP photo");
  try {
    const { data, info } = await sharp(input, { limitInputPixels: 40_000_000, failOn: "error" })
      .rotate()
      .resize(side, side, { fit: "cover" })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: 85, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });
    return { body: data, width: info.width, height: info.height, contentType: "image/jpeg" };
  } catch {
    throw new ImageRejected("This photo couldn't be read");
  }
}
