import { readUploadToken } from "./auth";
import { renderScaled, MAIN_MAX_EDGE, MAIN_QUALITY, THUMB_MAX_EDGE, THUMB_QUALITY } from "./image-resize";

// ── Entry images (client side) ───────────────────────────────────────────────
//
// Photos live in Cloudflare R2, NOT in Postgres. Supabase stores only a small JSONB
// array per row — `images` on `accessories`, `fabrics` and `product_costings` — so the
// database stays exactly as light as it is today no matter how many photos are added.
//
//   Postgres:  [{ key: "acc/<id>/<uuid>.jpg", name: "ซิปดำ.jpg", uploaded_at: "..." }]
//   R2:        the bytes, at that key
//   <img src>: NEXT_PUBLIC_R2_PUBLIC_BASE + "/" + key   (public bucket / custom domain)
//
// Upload is a two-step: ask /api/images/sign for a presigned PUT (the server picks the
// key and checks the login token), then PUT the file straight to R2 from the browser —
// the bytes never touch Vercel, which is what keeps a 8 MB phone photo from hitting the
// 4.5 MB API body cap.

// `thumb_key` is OPTIONAL on purpose: images uploaded before thumbnails existed have
// only `key`, and thumbUrl() falls back to it — so nothing needs backfilling.
export type StoredImage = { key: string; thumb_key?: string; name: string; uploaded_at: string };

export type ImageScope = "acc" | "fabric" | "order";

// What the SERVER accepts per uploaded object. Since the browser downscales first, real
// uploads land far under this; it only bites on the rare can't-decode fallback path.
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
// What a user may PICK. Larger than the above because a 20 MB camera file is perfectly
// fine — it becomes a ~250 KB JPEG before it's sent (see lib/image-resize.ts).
export const MAX_SOURCE_BYTES = 25 * 1024 * 1024;
export const IMAGE_ACCEPT = "image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif";

const PUBLIC_BASE = (process.env.NEXT_PUBLIC_R2_PUBLIC_BASE ?? "").replace(/\/+$/, "");

// True when the front end has somewhere to read images from. When false the gallery
// renders a short "not configured" note instead of broken thumbnails.
export const imagesConfigured = (): boolean => PUBLIC_BASE !== "";

export const imageUrl = (key: string): string => `${PUBLIC_BASE}/${key}`;

// URL for a LIST/GRID context: the small thumbnail when there is one, otherwise the
// full image (older uploads, or one whose thumbnail failed). Use imageUrl(img.key)
// only where the picture is actually being looked at full size.
export const thumbUrl = (img: StoredImage): string => imageUrl(img.thumb_key || img.key);

// Whatever Postgres hands back — [], null, a missing column, or something hand-edited —
// becomes a clean array. Every read goes through this, so no caller has to defend itself.
export function normalizeImages(value: unknown): StoredImage[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((v: any) =>
    v && typeof v.key === "string" && v.key
      ? [{
          key: v.key,
          ...(typeof v.thumb_key === "string" && v.thumb_key ? { thumb_key: v.thumb_key } : {}),
          name: typeof v.name === "string" ? v.name : "",
          uploaded_at: typeof v.uploaded_at === "string" ? v.uploaded_at : "",
        }]
      : []
  );
}

const authHeaders = (): Record<string, string> => {
  const token = readUploadToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
};

// Sign one object and PUT it. Returns the key R2 stored it under.
async function putObject(body: Blob, contentType: string, scope: ImageScope, id: string): Promise<string> {
  const signRes = await fetch("/api/images/sign", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ scope, id, contentType, size: body.size }),
  });
  const signed = await signRes.json().catch(() => ({}));
  if (!signRes.ok) throw new Error(signed.error ?? "ขอลิงก์อัปโหลดไม่สำเร็จ");

  // Straight to R2. Content-Type must match what was signed or R2 rejects it.
  let put: Response;
  try {
    put = await fetch(signed.uploadUrl, { method: "PUT", headers: { "Content-Type": contentType }, body });
  } catch {
    // fetch() rejects (rather than returning a status) when the browser blocks the request
    // outright — in practice always the R2 bucket's CORS rule not listing THIS origin, so
    // the preflight 403s and the upload is never sent. Naming the origin turns an opaque
    // "Failed to fetch" into the one fact needed to fix it.
    throw new Error(
      `อัปโหลดไปที่ R2 ไม่ได้ — เบราว์เซอร์ถูกบล็อก (CORS) สำหรับ ${typeof location !== "undefined" ? location.origin : "หน้านี้"} ` +
      `· ให้เพิ่ม origin นี้ในการตั้งค่า CORS ของบัคเก็ต R2 แล้วลองใหม่`
    );
  }
  if (!put.ok) throw new Error(`อัปโหลดไม่สำเร็จ (${put.status})`);
  return signed.key as string;
}

// Upload one picked file and return the record to append to the entry's `images` array.
// The file is downscaled in the browser first (see lib/image-resize.ts) and stored as
// TWO objects — a ~1600px viewing copy and a ~320px thumbnail — so lists stay cheap.
// Throws with a Thai message the caller can toast directly.
export async function uploadImage(file: File, scope: ImageScope, id: string): Promise<StoredImage> {
  if (file.size > MAX_SOURCE_BYTES) {
    throw new Error(`${file.name}: ไฟล์ใหญ่เกิน ${Math.round(MAX_SOURCE_BYTES / 1024 / 1024)} MB`);
  }
  if (!readUploadToken()) {
    throw new Error("ต้องเข้าสู่ระบบก่อนจึงจะอัปโหลดรูปได้ (ถ้าเพิ่งเข้าระบบไว้ก่อนหน้านี้ ให้ออกแล้วเข้าใหม่)");
  }

  let main: Blob | null = null;
  let thumb: Blob | null = null;
  try {
    main = (await renderScaled(file, MAIN_MAX_EDGE, MAIN_QUALITY)).blob;
    thumb = (await renderScaled(file, THUMB_MAX_EDGE, THUMB_QUALITY)).blob;
  } catch {
    // This browser can't decode the file. Overwhelmingly that means HEIC on Windows or
    // Android — and uploading it raw would store a photo those same browsers can't
    // display, so refuse with an instruction instead of silently creating a broken row.
    if (/heic|heif/i.test(file.type) || /\.hei[cf]$/i.test(file.name)) {
      throw new Error(`${file.name}: เปิดไฟล์ HEIC บนเครื่องนี้ไม่ได้ — กรุณาแปลงเป็น JPG ก่อน (หรืออัปโหลดจาก iPhone โดยตรง)`);
    }
    main = null;   // other formats: fall back to the original bytes below
  }

  // Never upload something BIGGER than what the user picked. Re-encoding can inflate an
  // image that is already small and well-optimised (downscaling adds high-frequency
  // detail JPEG spends bytes on), so when the "optimised" copy loses, keep the original.
  // Only for types every browser renders — a HEIC original would defeat the conversion.
  const webSafe = /^image\/(jpeg|png|webp|gif)$/.test(file.type);
  if (main && webSafe && main.size >= file.size && file.size <= MAX_IMAGE_BYTES) {
    main = null;
  }

  // Uploading the original untouched, so the server's own per-object cap applies.
  if (!main && file.size > MAX_IMAGE_BYTES) {
    throw new Error(`${file.name}: ย่อรูปบนเครื่องนี้ไม่ได้ และไฟล์ใหญ่เกิน ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)} MB`);
  }

  const key = main
    ? await putObject(main, "image/jpeg", scope, id)
    : await putObject(file, file.type, scope, id);

  // A missing thumbnail is survivable (thumbUrl falls back to the full image), so a
  // failure here must not throw away a main image that uploaded fine.
  let thumb_key: string | undefined;
  if (thumb) {
    try {
      thumb_key = await putObject(thumb, "image/jpeg", scope, id);
    } catch {
      thumb_key = undefined;
    }
  }

  return { key, ...(thumb_key ? { thumb_key } : {}), name: file.name, uploaded_at: new Date().toISOString() };
}

// Best-effort removal of the stored objects — BOTH the full image and its thumbnail.
// The caller has already persisted the shortened array, so a failure here leaves an
// orphan in the bucket, not a broken entry — hence it resolves either way rather than
// throwing into a delete flow that already succeeded.
export async function deleteImageObject(img: StoredImage | string): Promise<void> {
  const keys = typeof img === "string" ? [img] : [img.key, ...(img.thumb_key ? [img.thumb_key] : [])];
  for (const key of keys) {
    try {
      await fetch("/api/images/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ key }),
      });
    } catch {
      /* orphaned object in R2 — harmless, and the entry is already correct */
    }
  }
}
