import type { NextApiRequest, NextApiResponse } from "next";

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end();

  const { username, password } = req.body;

  // Trim leading/trailing spaces so accidental whitespace doesn't block login
  const cleanUsername = typeof username === "string" ? username.trim() : "";
  const cleanPassword = typeof password === "string" ? password.trim() : "";

  if (
    cleanUsername === (process.env.MANAGE_USERNAME ?? "").trim() &&
    cleanPassword === (process.env.MANAGE_PASSWORD ?? "").trim()
  ) {
    return res.status(200).json({ ok: true });
  }

  return res.status(401).json({ error: "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง" });
}
