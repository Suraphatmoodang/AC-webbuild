import type { NextApiRequest, NextApiResponse } from "next";
import type { Role } from "@/lib/auth";

// Accounts live in env vars — one pair per role. Set these in .env.local locally
// and in the Vercel project settings for the deployed site:
//
//   ACC_ADMIN_USERNAME    / ACC_ADMIN_PASSWORD      → accessory ops (transactions + suppliers)
//   FABRIC_ADMIN_USERNAME / FABRIC_ADMIN_PASSWORD   → fabric ops (transactions + suppliers)
//   AUDIT_USERNAME        / AUDIT_PASSWORD          → ops on BOTH sides, no admin pages
//   SUPER_ADMIN_USERNAME  / SUPER_ADMIN_PASSWORD    → everything
//
// Only `super` may open manage / import / import-review / stock-update / admin-log.
// See lib/auth.ts `roleCan` for the full rule.
//
// The original MANAGE_USERNAME / MANAGE_PASSWORD pair still works and is treated
// as a super admin, so an existing deployment keeps logging in unchanged.
//
// Order matters: the first entry whose credentials match wins, so if two roles are
// configured with the same username the earlier one takes it. Passwords are compared
// in plaintext — fine for env-var accounts, but see lib/auth.ts on why none of this
// is a real security boundary.
const ACCOUNTS: { role: Role; user?: string; pass?: string }[] = [
  { role: "super",  user: process.env.SUPER_ADMIN_USERNAME,  pass: process.env.SUPER_ADMIN_PASSWORD },
  { role: "super",  user: process.env.MANAGE_USERNAME,       pass: process.env.MANAGE_PASSWORD },
  { role: "acc",    user: process.env.ACC_ADMIN_USERNAME,    pass: process.env.ACC_ADMIN_PASSWORD },
  { role: "fabric", user: process.env.FABRIC_ADMIN_USERNAME, pass: process.env.FABRIC_ADMIN_PASSWORD },
  { role: "audit",  user: process.env.AUDIT_USERNAME,        pass: process.env.AUDIT_PASSWORD },
];

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end();

  const { username, password } = req.body;

  // Trim leading/trailing spaces so accidental whitespace doesn't block login
  const cleanUsername = typeof username === "string" ? username.trim() : "";
  const cleanPassword = typeof password === "string" ? password.trim() : "";
  if (!cleanUsername || !cleanPassword) {
    return res.status(401).json({ error: "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง" });
  }

  for (const acct of ACCOUNTS) {
    // Skip roles that aren't configured — an unset env var must never match the
    // empty string a missing field would trim down to.
    const user = (acct.user ?? "").trim();
    const pass = (acct.pass ?? "").trim();
    if (!user || !pass) continue;

    if (cleanUsername === user && cleanPassword === pass) {
      return res.status(200).json({ ok: true, role: acct.role });
    }
  }

  return res.status(401).json({ error: "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง" });
}
