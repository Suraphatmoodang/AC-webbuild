import { readUploadToken } from "./auth";

// ── Client side of the data API routes ──────────────────────────────────────
//
// The three private tables are closed to the browser's anon key by row level
// security (see lib/supabase-admin.ts), so lead-store / costing-store /
// product-store go through pages/api/data/* instead of talking to Supabase.
// This is the one place that attaches the login token and unwraps the reply, so
// the stores stay as readable as they were when they held raw queries.
//
// Throws on failure, with the server's Thai message when there is one — the app's
// convention is "stores throw, pages catch and notify", and that is unchanged.
//
// A token expires 12h after login. Before this existed that only stopped image
// uploads; now it also ends a session's access to these three sections, so a board
// left open overnight asks for a fresh login instead of silently showing nothing.

export async function apiCall<T>(route: "leads" | "costings" | "products", op: string, body: Record<string, unknown> = {}): Promise<T> {
  const token = readUploadToken();
  if (!token) throw new Error("เซสชันหมดอายุ — กรุณาเข้าสู่ระบบใหม่");

  let res: Response;
  try {
    res = await fetch(`/api/data/${route}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ op, ...body }),
    });
  } catch {
    // fetch() rejects rather than returning a status when the network is down.
    throw new Error("เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ — ตรวจสอบอินเทอร์เน็ตแล้วลองอีกครั้ง");
  }

  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error((json as any)?.error ?? `บันทึกไม่สำเร็จ (${res.status})`);
  return (json as any)?.data as T;
}
