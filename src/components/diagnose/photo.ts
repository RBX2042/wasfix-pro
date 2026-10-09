/**
 * Getting a phone photo small enough to send.
 *
 * A modern phone photo is 3-8 MB. Serverless platforms reject request bodies
 * above about 4.5 MB with a 413 before our route even runs, so an ordinary photo
 * of the display would fail for exactly the people who need it. The browser
 * therefore redraws the picture on a canvas and re-encodes it as JPEG until it is
 * at most PHOTO_TARGET_BYTES. A display readout does not need more pixels than
 * that, and the re-encode drops the EXIF block (location, camera) before upload.
 */

export const PHOTO_TARGET_BYTES = 1.5 * 1024 * 1024;
export const PHOTO_START_EDGE = 1600;
export const PHOTO_MIN_EDGE = 640;

/** Scale (w, h) down so the longest edge is at most `max`; never scales up. */
export function fitDimensions(w: number, h: number, max: number): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}

export class PhotoError extends Error {
  constructor(public reason: "not_image" | "undecodable" | "too_big") {
    super(reason);
  }
}

async function decode(file: File): Promise<{ source: CanvasImageSource; width: number; height: number; close: () => void }> {
  if (typeof createImageBitmap === "function") {
    try {
      // "from-image" applies the EXIF rotation, so a portrait photo is not sent sideways.
      const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
      return { source: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close() };
    } catch {
      // fall through to <img>
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new PhotoError("undecodable"));
      el.src = url;
    });
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => undefined };
  } finally {
    URL.revokeObjectURL(url);
  }
}

const toBlob = (canvas: HTMLCanvasElement, quality: number) =>
  new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));

/** Returns a JPEG of at most `targetBytes`, or throws PhotoError. */
export async function preparePhoto(file: File, targetBytes: number = PHOTO_TARGET_BYTES): Promise<Blob> {
  if (!file.type.startsWith("image/")) throw new PhotoError("not_image");
  const img = await decode(file).catch(() => {
    throw new PhotoError("undecodable");
  });
  try {
    let edge = PHOTO_START_EDGE;
    for (;;) {
      const { width, height } = fitDimensions(img.width, img.height, edge);
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new PhotoError("undecodable");
      // A white base: a PNG with transparency would otherwise turn black as JPEG.
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img.source, 0, 0, width, height);
      for (const q of [0.82, 0.7, 0.58]) {
        const blob = await toBlob(canvas, q);
        if (blob && blob.size <= targetBytes) return blob;
      }
      if (edge <= PHOTO_MIN_EDGE) throw new PhotoError("too_big");
      edge = Math.max(PHOTO_MIN_EDGE, Math.round(edge * 0.75));
    }
  } finally {
    img.close();
  }
}
