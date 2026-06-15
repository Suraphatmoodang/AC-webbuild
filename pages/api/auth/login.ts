import type { NextApiRequest, NextApiResponse } from "next";

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end();

  const { username, password } = req.body;

  if (
    username === process.env.MANAGE_USERNAME &&
    password === process.env.MANAGE_PASSWORD
  ) {
    return res.status(200).json({ ok: true });
  }

  return res.status(401).json({ error: "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง" });
}
