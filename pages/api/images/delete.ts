import type { NextApiRequest, NextApiResponse } from "next";
import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import { r2, r2Configured, R2_BUCKET } from "@/lib/r2";
import { verifyUploadToken, uploadTokenConfigured } from "@/lib/upload-token";

// Delete one object from R2. Called when a user removes an image from an entry, so the
// bucket doesn't keep paying for pictures nothing references.
//
// The DB row is the source of truth for what an entry shows: the client removes the key
// from the `images` array and persists that FIRST, then calls this. If this call fails,
// the result is a harmless orphan in the bucket — never an entry pointing at a file
// that no longer exists.

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end();

  if (!uploadTokenConfigured() || !r2Configured()) {
    return res.status(503).json({ error: "ยังไม่ได้ตั้งค่าที่เก็บรูปบนเซิร์ฟเวอร์" });
  }

  const header = req.headers.authorization ?? "";
  const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : (req.body?.token ?? null);
  if (!verifyUploadToken(token)) {
    return res.status(401).json({ error: "เซสชันหมดอายุ — กรุณาเข้าสู่ระบบใหม่แล้วลองอีกครั้ง" });
  }

  const { key } = (req.body ?? {}) as { key?: string };
  // Only keys in the shape this app mints: <scope>/<uuid>/<uuid>.<ext>. Stops a caller
  // from deleting arbitrary objects if the bucket is ever shared with something else.
  if (typeof key !== "string" || !/^(acc|fabric|order)\/[0-9a-fA-F-]{36}\/[0-9a-fA-F-]{36}\.[a-z]{3,4}$/.test(key)) {
    return res.status(400).json({ error: "key ไม่ถูกต้อง" });
  }

  try {
    await r2().send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: key }));
    return res.status(200).json({ ok: true });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message ?? "ลบไฟล์ไม่สำเร็จ" });
  }
}
