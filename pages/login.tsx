import { useState } from "react";
import { useRouter } from "next/router";
import { startSession, HOME_FOR, type Role } from "@/lib/auth";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError]       = useState("");
  const [loading, setLoading]   = useState(false);

  const handleLogin = async () => {
    const u = username.trim();
    const p = password.trim();
    if (!u || !p) { setError("กรุณากรอกชื่อผู้ใช้และรหัสผ่าน"); return; }
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: u, password: p }),
      });
      if (res.ok) {
        // The server decides the role from which account matched; a section admin
        // lands in their own section, the super admin gets the picker.
        const { role } = (await res.json()) as { role?: Role };
        const r: Role = role ?? "super";
        startSession(r);
        router.push(HOME_FOR[r]);
      } else {
        const data = await res.json();
        setError(data.error ?? "เกิดข้อผิดพลาด");
      }
    } catch {
      setError("ไม่สามารถเชื่อมต่อได้");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: "80vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ width: "100%", maxWidth: 360 }}>
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{ fontFamily: "var(--mono)", fontSize: 20, color: "var(--accent)", fontWeight: 500, letterSpacing: "0.05em" }}>
            ACCESSORY · FABRIC
          </div>
          <div style={{ fontSize: 23, fontWeight: 500, marginTop: 8 }}>จัดการระบบ</div>
          <div style={{ fontSize: 17, color: "var(--text3)", marginTop: 4 }}>Manage — Login required</div>
          <div style={{ fontSize: 14, color: "var(--text3)", marginTop: 8 }}>
            ระบบจะพาไปยังส่วนที่บัญชีของคุณดูแลโดยอัตโนมัติ
          </div>
        </div>

        <div className="card" style={{ padding: 24 }}>
          <div className="form-row">
            <label className="form-label">ชื่อผู้ใช้ · Username</label>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="username"
              autoComplete="username"
              onKeyDown={(e) => e.key === "Enter" && handleLogin()}
            />
          </div>
          <div className="form-row">
            <label className="form-label">รหัสผ่าน · Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
              onKeyDown={(e) => e.key === "Enter" && handleLogin()}
            />
          </div>

          {error && (
            <div style={{ color: "var(--red)", fontSize: 14, marginBottom: 12, padding: "8px 10px", background: "var(--red2)", borderRadius: "var(--r)" }}>
              {error}
            </div>
          )}

          <button
            className="primary"
            style={{ width: "100%", padding: "10px", fontSize: 16, opacity: loading ? 0.6 : 1 }}
            onClick={handleLogin}
            disabled={loading}
          >
            {loading ? "กำลังตรวจสอบ…" : "เข้าสู่ระบบ"}
          </button>
        </div>
      </div>
    </div>
  );
}
