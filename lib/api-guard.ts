import type { NextApiRequest, NextApiResponse } from "next";
import { verifyUploadToken, uploadTokenConfigured } from "./upload-token";
import { adminConfigured } from "./supabase-admin";

// ── Authorisation for the data API routes (SERVER ONLY) ─────────────────────
//
// The app's sessionStorage role is meaningless to an API route — anyone can POST
// to one. What IS checkable is the HMAC token minted by /api/auth/login, which
// carries the role and an expiry (lib/upload-token.ts). It was built for the image
// routes; the data routes reuse it, and the role claim is what lets the server
// enforce "orders and leads are super-only" instead of trusting the client to.
//
// Fails CLOSED on misconfiguration: no UPLOAD_TOKEN_SECRET or no service-role key
// means refuse, never fall through to an unauthenticated read.
//
// NOTE on scope: every WRITE op behind this guard is super-only, and super already
// has full authority over these tables by design — so there is no column allow-list
// on the payloads. The one op open to other roles (costings `activeOrders`) is
// read-only with a fixed projection. Keep that property if you add an op: anything
// writable, or returning whole rows, stays super.

export type Guard = { role: string };

// Returns the caller's claims, or null having ALREADY sent the error response.
export function requireAuth(req: NextApiRequest, res: NextApiResponse): Guard | null {
  if (req.method !== "POST") { res.status(405).end(); return null; }

  if (!uploadTokenConfigured()) {
    res.status(503).json({ error: "เซิร์ฟเวอร์ยังไม่ได้ตั้งค่า UPLOAD_TOKEN_SECRET — ใช้งานส่วนนี้ไม่ได้" });
    return null;
  }
  if (!adminConfigured()) {
    res.status(503).json({ error: "เซิร์ฟเวอร์ยังไม่ได้ตั้งค่า SUPABASE_SERVICE_ROLE_KEY — ใช้งานส่วนนี้ไม่ได้" });
    return null;
  }

  const header = req.headers.authorization ?? "";
  const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : null;
  const claims = verifyUploadToken(token);
  if (!claims) {
    res.status(401).json({ error: "เซสชันหมดอายุ — กรุณาเข้าสู่ระบบใหม่" });
    return null;
  }
  return { role: claims.role };
}

// Leads: super OR the dedicated sales account. Mirrors canLeads() in lib/auth.ts —
// the page gate decides what renders, this decides what the data API will answer, and
// only the second one is enforceable.
export function requireLeads(req: NextApiRequest, res: NextApiResponse): Guard | null {
  const g = requireAuth(req, res);
  if (!g) return null;
  if (g.role !== "super" && g.role !== "leads") {
    res.status(403).json({ error: "ไม่มีสิทธิ์เข้าถึงข้อมูลลีด" });
    return null;
  }
  return g;
}

// As above, but also demands the super-admin role. Used by every op that reads or
// writes a whole private row (orders, leads, the product catalogue) — the same rule
// the pages apply client-side, now enforced where it cannot be edited away.
export function requireSuper(req: NextApiRequest, res: NextApiResponse): Guard | null {
  const g = requireAuth(req, res);
  if (!g) return null;
  if (g.role !== "super") {
    res.status(403).json({ error: "ต้องเป็นแอดมินสูงสุดเท่านั้น" });
    return null;
  }
  return g;
}
