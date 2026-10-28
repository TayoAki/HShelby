import { PHOTO_LIMITS } from "@hshelby/contracts";

const toBlob = (canvas: HTMLCanvasElement, type: string, quality?: number) =>
  new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));

/**
 * Redraws a picked image within the limits the server enforces: EXIF orientation applied, longest side at
 * most 2048 px, at most 1 MB. Redrawing every photo also drops its metadata (a phone photo's location, say).
 * PNGs stay PNG when they fit, so screenshots stay sharp; anything else becomes JPEG, lowering quality
 * until it fits.
 */
export async function preparePhoto(file: File): Promise<File> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" }).catch(() => {
    throw new Error("This file isn't a photo that can be sent");
  });
  const scale = Math.min(1, PHOTO_LIMITS.pixels / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d")!;
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const name = file.name.replace(/\.\w+$/, "") || "photo";

  if (file.type === "image/png") {
    const png = await toBlob(canvas, "image/png");
    if (png && png.size <= PHOTO_LIMITS.bytes) return new File([png], `${name}.png`, { type: "image/png" });
  }
  // JPEG has no transparency: put white behind the image rather than let clear pixels turn black
  context.globalCompositeOperation = "destination-over";
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  for (const quality of [0.86, 0.75, 0.6, 0.45]) {
    const jpeg = await toBlob(canvas, "image/jpeg", quality);
    if (jpeg && jpeg.size <= PHOTO_LIMITS.bytes) return new File([jpeg], `${name}.jpg`, { type: "image/jpeg" });
  }
  throw new Error("This photo is too large to send");
}
