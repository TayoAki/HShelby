export type ImageInfo = { contentType: "image/jpeg" | "image/png"; width: number; height: number };

/**
 * Type and pixel size from the file's own header (PNG IHDR, JPEG frame header), so neither depends on
 * what the client claimed. Null for anything that isn't a PNG or JPEG.
 */
export function inspectImage(b: Buffer): ImageInfo | null {
  const valid = (info: ImageInfo) => (info.width > 0 && info.height > 0 ? info : null);

  if (b.length >= 24 && b.readUInt32BE(0) === 0x89504e47 && b.readUInt32BE(4) === 0x0d0a1a0a && b.toString("ascii", 12, 16) === "IHDR") {
    return valid({ contentType: "image/png", width: b.readUInt32BE(16), height: b.readUInt32BE(20) });
  }

  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) return null;
      const marker = b[i + 1]!;
      if (marker === 0xff) {
        i += 1; // fill byte
        continue;
      }
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
        i += 2; // markers without a length
        continue;
      }
      // SOF0–SOF15 carry the frame size; C4 (DHT), C8 (JPG) and CC (DAC) share the range but don't
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return valid({ contentType: "image/jpeg", height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) });
      }
      if (marker === 0xda) return null; // image data before any frame header
      i += 2 + b.readUInt16BE(i + 2);
    }
  }
  return null;
}
