import type { AppProps } from "next/app";
import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import { readRole, endSession, roleCan, ROLE_LABELS, type Role, type Area } from "@/lib/auth";
import "@/styles/globals.css";

// Show the tab logo only on deployed (Vercel) builds. NODE_ENV is "production"
// on any built/deployed site and "development" under `npm run dev`, so local
// testing stays blank (default browser icon) while the live site shows the logo.
const IS_DEPLOYED = process.env.NODE_ENV === "production";

// `area` undefined = public page, never gated. Otherwise it must match the gate
// the page itself declares via useRequireAccess — keep the two in step.
// `guest` = still shown to LOGGED-OUT users even though it's gated, so there is a
// visible way in: clicking it is what triggers the login prompt. Exactly one item
// per section carries this, otherwise the nav is cluttered for ordinary staff who
// only ever view stock.
type NavItem = { href: string; label: string; en: string; area?: Area; guest?: boolean };

// Two independent sections, each with its own pages, its own nav and its own data
// — including suppliers, which are now separate tables per section. /suppliers and
// /fabrics/suppliers reuse the same VIEW component but are bound to different
// stores, so each section keeps its own route and the nav never flips section
// under the user's feet.
const NAV_ACC: NavItem[] = [
  { href: "/stock", label: "สต็อค", en: "Stock" },
  { href: "/transactions", label: "บันทึกรายการ", en: "Transactions 🔒", area: "ops", guest: true },
  { href: "/history", label: "ประวัติ", en: "History" },
  { href: "/manage", label: "จัดการ", en: "Manage 🔒", area: "admin" },
  { href: "/suppliers", label: "ซัพพลายเออร์", en: "Suppliers 🔒", area: "ops" },
  { href: "/import-review", label: "นำเข้า", en: "Import 🔒", area: "admin" },
  { href: "/stock-update", label: "อัปเดตสต็อค", en: "Update 🔒", area: "admin" },
  { href: "/admin-log", label: "สรุป/บันทึก", en: "Summary 🔒", area: "admin" },
];

const NAV_FABRIC: NavItem[] = [
  { href: "/fabrics", label: "สต็อค", en: "Stock" },
  { href: "/fabrics/transactions", label: "บันทึกรายการ", en: "Transactions 🔒", area: "ops", guest: true },
  { href: "/fabrics/history", label: "ประวัติ", en: "History" },
  { href: "/fabrics/manage", label: "จัดการ", en: "Manage 🔒", area: "admin" },
  { href: "/fabrics/suppliers", label: "ซัพพลายเออร์", en: "Suppliers 🔒", area: "ops" },
  { href: "/fabrics/import-review", label: "นำเข้า", en: "Import 🔒", area: "admin" },
  { href: "/fabrics/stock-update", label: "อัปเดตสต็อค", en: "Update 🔒", area: "admin" },
  { href: "/fabrics/admin-log", label: "สรุป/บันทึก", en: "Summary 🔒", area: "admin" },
];

// "/" is the section picker and "/login" belongs to neither — both render bare
// (logo only, no nav). Everything under /fabrics is the fabric section.
function sectionFor(pathname: string): "acc" | "fabric" | "none" {
  if (pathname === "/" || pathname === "/login") return "none";
  return pathname.startsWith("/fabrics") ? "fabric" : "acc";
}

const TITLES = {
  acc:    { code: "ACC",     word: "STOCK",    href: "/stock" },
  fabric: { code: "ผ้า",     word: "FABRIC",   href: "/fabrics" },
  none:   { code: "Apparel", word: "Creation", href: "/" },
} as const;

export default function App({ Component, pageProps }: AppProps) {
  const router = useRouter();
  const [role, setRole] = useState<Role | null>(null);

  // Re-check the session on every route change so gated links appear right after login
  useEffect(() => {
    const check = () => setRole(readRole());
    check();
    router.events.on("routeChangeComplete", check);
    return () => router.events.off("routeChangeComplete", check);
  }, [router.events]);

  const authed = role !== null;
  const section = sectionFor(router.pathname);
  const nav = section === "fabric" ? NAV_FABRIC : section === "acc" ? NAV_ACC : [];
  // Nav visibility:
  //  · public items (no `area`) always show — viewing stock never needs a login.
  //  · LOGGED OUT: gated items still show, so clicking one is what triggers the
  //    login prompt. Nothing auto-prompts; the gate appears on demand.
  //  · LOGGED IN: only what this role can actually open, so an accessory admin
  //    sees no admin links and no fabric-section links.
  const visibleNav = nav.filter((n) => {
    if (!n.area) return true;                 // public: viewing stock never needs a login
    if (role === null) return !!n.guest;      // logged out: ONLY the guest entry point
    return section !== "none" && roleCan(role, section, n.area);
  });
  const title = TITLES[section];

  const logout = () => {
    endSession();
    setRole(null);
    router.push("/login");
  };

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <Head>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        {IS_DEPLOYED && <link rel="icon" type="image/png" href="/favicon.png" />}
      </Head>
      <header style={{
        borderBottom: "1px solid var(--border)",
        background: "var(--bg)",
        position: "sticky", top: 0, zIndex: 50,
      }}>
        <div className="app-hdr" style={{ maxWidth: 1280, margin: "0 auto", padding: "0 24px", display: "flex", alignItems: "center", gap: 20, height: 70 }}>
          <Link href={title.href} style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span style={{ fontFamily: "var(--mono)", fontSize: 20, color: "var(--accent)", fontWeight: 500, letterSpacing: "0.05em" }}>{title.code}</span>
            <span style={{ fontSize: 20, color: "var(--text3)", letterSpacing: "0.04em" }}>{title.word}</span>
          </Link>
          {/* Back to the section picker — only meaningful once inside a section */}
          {section !== "none" && (
            <Link href="/" title="เลือกระบบ" aria-label="เลือกระบบ"
              style={{ fontSize: 18, color: "var(--text3)", padding: "2px 6px", lineHeight: 1 }}>
              ⇄
            </Link>
          )}
          <nav className="app-nav" style={{ display: "flex", gap: 2, flex: 1 }}>
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
          <span className="app-date" style={{ fontSize: 16, color: "var(--text3)", fontFamily: "var(--mono)" }}>
            {new Date().toLocaleDateString("th-TH", { day: "2-digit", month: "short", year: "numeric" })}
          </span>
          {role && (
            <span className="app-role" title={ROLE_LABELS[role].en}
              style={{ fontSize: 13, color: "var(--text2)", background: "var(--bg3)", border: "1px solid var(--border)",
                borderRadius: "var(--r)", padding: "3px 8px", whiteSpace: "nowrap" }}>
              {ROLE_LABELS[role].th}
            </span>
          )}
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
      <main className="app-main" style={{ flex: 1, maxWidth: 1280, margin: "0 auto", padding: "24px", width: "100%" }}>
        <Component {...pageProps} />
      </main>
    </div>
  );
}
