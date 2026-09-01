// ── Browser-side image downscaling (client only) ─────────────────────────────
//
// Every uploaded photo is re-rendered through a canvas before it leaves the browser,
// producing TWO JPEGs: a viewing copy (~1600px) and a thumbnail (~320px). Reasons, in
// order of how much they matter:
//
//  1. Table thumbnails would otherwise download the ORIGINAL. A manage page listing 50
//     items with 4 MB phone photos pulled ~200 MB; with a 320px thumb it's about 1 MB.
//  2. Phone cameras produce 3–8 MB files where ~250 KB is indistinguishable for the job
//     (identifying a zip or a weave), so R2 storage and egress drop roughly 15×.
//  3. It converts HEIC to JPEG. iOS Safari can decode HEIC, so the conversion happens on
//     the phone that took the photo — which fixes iPhone uploads showing as broken
//     images on the office PC, since Chrome on Windows/Android cannot render HEIC.
//
// Trade-off accepted: the original is NOT kept. EXIF (including GPS) is dropped by the
// canvas, which is a small privacy win and irrelevant to stock photos.

export const MAIN_MAX_EDGE = 1600;
export const MAIN_QUALITY = 0.82;
export const THUMB_MAX_EDGE = 320;
export const THUMB_QUALITY = 0.72;

export type Scaled = { blob: Blob; width: number; height: number };

type Loaded = { img: CanvasImageSource; width: number; height: number; cleanup: () => void };

// createImageBitmap is the fast path and — importantly — the one that honours the EXIF
// orientation flag, so a photo taken sideways doesn't upload sideways. Older browsers
// fall back to an <img>, which applies orientation itself in every current engine.
async function loadImage(file: File): Promise<Loaded> {
  if (typeof createImageBitmap === "function") {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: "from-image" } as ImageBitmapOptions);
      return { img: bmp, width: bmp.width, height: bmp.height, cleanup: () => bmp.close() };
    } catch {
      /* fall through — some engines reject options or the format; try the <img> path */
    }
  }

  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("decode failed"));
      img.src = url;
    });
    return { img, width: img.naturalWidth, height: img.naturalHeight, cleanup: () => URL.revokeObjectURL(url) };
  } catch (e) {
    URL.revokeObjectURL(url);
    throw e;
  }
}

// Scale to fit inside maxEdge and re-encode as JPEG. NEVER upscales: a small image is
// re-encoded at its own size rather than blown up into a bigger, blurrier file.
export async function renderScaled(file: File, maxEdge: number, quality: number): Promise<Scaled> {
  const src = await loadImage(file);
  try {
    if (!src.width || !src.height) throw new Error("empty image");
    const scale = Math.min(1, maxEdge / Math.max(src.width, src.height));
    const width = Math.max(1, Math.round(src.width * scale));
    const height = Math.max(1, Math.round(src.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d context");

    // JPEG has no alpha channel: without this, a transparent PNG comes out with a black
    // background instead of white.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(src.img, 0, 0, width, height);

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    if (!blob) throw new Error("encode failed");
    return { blob, width, height };
  } finally {
    src.cleanup();
  }
}
