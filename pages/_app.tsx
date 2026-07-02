import type { AppProps } from "next/app";
import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import "@/styles/globals.css";

const NAV = [
  { href: "/", label: "สต็อค", en: "Stock", auth: false },
  { href: "/transactions", label: "บันทึกรายการ", en: "Transactions 🔒", auth: true },
  { href: "/history", label: "ประวัติ", en: "History", auth: false },
  { href: "/manage", label: "จัดการ", en: "Manage 🔒", auth: false },
  { href: "/suppliers", label: "ซัพพลายเออร์", en: "Suppliers 🔒", auth: true },
  { href: "/import-review", label: "นำเข้า", en: "Import 🔒", auth: true },
  { href: "/stock-update", label: "อัปเดตสต็อค", en: "Update 🔒", auth: true },
  { href: "/admin-log", label: "สรุป/บันทึก", en: "Summary 🔒", auth: true },
];

export default function App({ Component, pageProps }: AppProps) {
  const router = useRouter();
  const [authed, setAuthed] = useState(false);

  // Re-check auth on every route change so the Suppliers link appears after login
  useEffect(() => {
    const check = () => setAuthed(sessionStorage.getItem("manage_auth") === "1");
    check();
    router.events.on("routeChangeComplete", check);
    return () => router.events.off("routeChangeComplete", check);
  }, [router.events]);

  const visibleNav = NAV.filter((n) => !n.auth || authed);

  const logout = () => {
    sessionStorage.removeItem("manage_auth");
    setAuthed(false);
    router.push("/login");
  };

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <header style={{
        borderBottom: "1px solid var(--border)",
        background: "var(--bg)",
        position: "sticky", top: 0, zIndex: 50,
      }}>
        <div style={{ maxWidth: 1280, margin: "0 auto", padding: "0 24px", display: "flex", alignItems: "center", gap: 20, height: 70 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span style={{ fontFamily: "var(--mono)", fontSize: 20, color: "var(--accent)", fontWeight: 500, letterSpacing: "0.05em" }}>ACC</span>
            <span style={{ fontSize: 20, color: "var(--text3)", letterSpacing: "0.04em" }}>STOCK</span>
          </div>
          <nav style={{ display: "flex", gap: 2, flex: 1 }}>
            {visibleNav.map((n) => {
              const active = router.pathname === n.href;
              return (
                <Link key={n.href} href={n.href} style={{
                  padding: "6px 10px",
                  borderRadius: "var(--r)",
                  fontSize: 14,
                  color: active ? "var(--accent)" : "var(--text2)",
                  background: active ? "var(--bg3)" : "transparent",
                  transition: "all 0.15s",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  lineHeight: 1.3,
                  whiteSpace: "nowrap",
                }}>
                  <span>{n.label}</span>
                  <span style={{ fontSize: 12, color: active ? "var(--accent2)" : "var(--text3)" }}>{n.en}</span>
                </Link>
              );
            })}
          </nav>
          <span style={{ fontSize: 16, color: "var(--text3)", fontFamily: "var(--mono)" }}>
            {new Date().toLocaleDateString("th-TH", { day: "2-digit", month: "short", year: "numeric" })}
          </span>
          {authed && (
            <button className="ghost" onClick={logout} title="ออกจากระบบ" aria-label="ออกจากระบบ"
              style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "6px 8px", color: "var(--text3)" }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
            </button>
          )}
        </div>
      </header>
      <main style={{ flex: 1, maxWidth: 1280, margin: "0 auto", padding: "24px", width: "100%" }}>
        <Component {...pageProps} />
      </main>
    </div>
  );
}
