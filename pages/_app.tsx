import type { AppProps } from "next/app";
import Link from "next/link";
import { useRouter } from "next/router";
import "@/styles/globals.css";

const NAV = [
  { href: "/", label: "สต็อค", en: "Stock" },
  { href: "/transactions", label: "บันทึกรายการ", en: "Transactions" },
  { href: "/history", label: "ประวัติ", en: "History" },
  { href: "/manage", label: "จัดการ", en: "Manage" },
];

export default function App({ Component, pageProps }: AppProps) {
  const router = useRouter();
  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <header style={{
        borderBottom: "1px solid var(--border)",
        background: "var(--bg)",
        position: "sticky", top: 0, zIndex: 50,
      }}>
        <div style={{ maxWidth: 1280, margin: "0 auto", padding: "0 24px", display: "flex", alignItems: "center", gap: 32, height: 52 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span style={{ fontFamily: "var(--mono)", fontSize: 13, color: "var(--accent)", fontWeight: 500, letterSpacing: "0.05em" }}>ACC</span>
            <span style={{ fontSize: 12, color: "var(--text3)", letterSpacing: "0.04em" }}>STOCK</span>
          </div>
          <nav style={{ display: "flex", gap: 2, flex: 1 }}>
            {NAV.map((n) => {
              const active = router.pathname === n.href;
              return (
                <Link key={n.href} href={n.href} style={{
                  padding: "6px 14px",
                  borderRadius: "var(--r)",
                  fontSize: 13,
                  color: active ? "var(--accent)" : "var(--text2)",
                  background: active ? "var(--bg3)" : "transparent",
                  transition: "all 0.15s",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  lineHeight: 1.3,
                }}>
                  <span>{n.label}</span>
                  <span style={{ fontSize: 10, color: active ? "var(--accent2)" : "var(--text3)" }}>{n.en}</span>
                </Link>
              );
            })}
          </nav>
          <span style={{ fontSize: 11, color: "var(--text3)", fontFamily: "var(--mono)" }}>
            {new Date().toLocaleDateString("th-TH", { day: "2-digit", month: "short", year: "numeric" })}
          </span>
        </div>
      </header>
      <main style={{ flex: 1, maxWidth: 1280, margin: "0 auto", padding: "24px", width: "100%" }}>
        <Component {...pageProps} />
      </main>
    </div>
  );
}
