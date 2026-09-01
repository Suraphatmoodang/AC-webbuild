import type { NextApiRequest, NextApiResponse } from "next";
import crypto from "crypto";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { r2, r2Configured, R2_BUCKET } from "@/lib/r2";
import { verifyUploadToken, uploadTokenConfigured } from "@/lib/upload-token";

// Mint a short-lived presigned PUT so the BROWSER uploads straight to R2.
//
// Why not just POST the file here: a Vercel API route caps the request body at 4.5 MB,
// which a phone photo clears easily, and proxying the bytes would burn function time
// and bandwidth for no benefit. The browser holds the file; this route only says
// "yes, you may write this one key, for the next 5 minutes".
//
// Everything the client sends is treated as a suggestion: the KEY is built here from
// a server-generated uuid, so a caller cannot choose where in the bucket to write, nor
// overwrite an existing object by naming its key.

const MAX_BYTES = 10 * 1024 * 1024;   // 10 MB — comfortably above a phone photo

// Scope = which section the image belongs to; also the bucket's top-level folder.
const SCOPES: Record<string, true> = { acc: true, fabric: true, order: true };

// Allow-list, because the extension is derived from it and the object is served from a
// public URL: an .svg or .html here would be a stored-XSS vector on the bucket's domain.
const TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/heic": "heic",
  "image/heif": "heif",
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end();

  if (!uploadTokenConfigured()) {
    return res.status(503).json({ error: "ยังไม่ได้ตั้งค่า UPLOAD_TOKEN_SECRET บนเซิร์ฟเวอร์ — อัปโหลดรูปไม่ได้" });
  }
  if (!r2Configured()) {
    return res.status(503).json({ error: "ยังไม่ได้ตั้งค่าที่เก็บรูป (R2) บนเซิร์ฟเวอร์ — อัปโหลดรูปไม่ได้" });
  }

  // Auth: the signed token from login. Header first, body as a fallback.
  const header = req.headers.authorization ?? "";
  const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : (req.body?.token ?? null);
  if (!verifyUploadToken(token)) {
    return res.status(401).json({ error: "เซสชันหมดอายุ — กรุณาเข้าสู่ระบบใหม่แล้วลองอีกครั้ง" });
  }

  const { scope, id, contentType, size } = (req.body ?? {}) as
    { scope?: string; id?: string; contentType?: string; size?: number };

  if (!scope || !SCOPES[scope]) return res.status(400).json({ error: "scope ไม่ถูกต้อง" });
  // Ids are Postgres uuids everywhere in this app; anything else is a caller doing
  // something unexpected, and it goes into a path, so keep it strict.
  if (typeof id !== "string" || !/^[0-9a-fA-F-]{36}$/.test(id)) {
    return res.status(400).json({ error: "id ไม่ถูกต้อง" });
  }
  const ext = contentType ? TYPES[contentType] : undefined;
  if (!ext) return res.status(400).json({ error: "รองรับเฉพาะไฟล์รูปภาพ (JPG / PNG / WEBP / GIF / HEIC)" });
  if (typeof size !== "number" || size <= 0 || size > MAX_BYTES) {
    return res.status(400).json({ error: `ไฟล์ต้องไม่เกิน ${Math.round(MAX_BYTES / 1024 / 1024)} MB` });
  }

  const key = `${scope}/${id}/${crypto.randomUUID()}.${ext}`;

  try {
    const uploadUrl = await getSignedUrl(
      r2(),
      new PutObjectCommand({ Bucket: R2_BUCKET, Key: key, ContentType: contentType }),
      { expiresIn: 300 }
    );
    return res.status(200).json({ key, uploadUrl });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message ?? "สร้างลิงก์อัปโหลดไม่สำเร็จ" });
  }
}
