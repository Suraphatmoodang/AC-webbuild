import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import { getAccessories, getLotMap, valueFromLots as accValue } from "@/lib/store";
import { getFabrics, getFabricLotMap, valueFromLots as fabValue } from "@/lib/fabric-store";
import { useSession, roleCanAccess, ROLE_LABELS, type Section } from "@/lib/auth";

// Section picker. The two stock systems (อุปกรณ์ / ผ้า) are fully independent —
// separate tables, separate pages, separate logs — and share only Suppliers.
// This page is the only place they meet, so it also shows a live count/value of
// each so you can see at a glance which side you're heading into.

type Stat = { items: number; value: number } | null;

const SECTIONS: { href: string; section: Section; title: string; en: string; blurb: string }[] = [
  {
    href: "/stock",
    section: "acc",
    title: "อุปกรณ์",
    en: "Accessories",
    blurb: "ซิป กระดุม ด้าย ยาง และอุปกรณ์ตัดเย็บทั้งหมด",
  },
  {
    href: "/fabrics",
    section: "fabric",
    title: "ผ้า",
    en: "Fabrics",
    blurb: "ชนิดผ้า เส้นใย โครงสร้าง หน้าผ้า และน้ำหนัก",
  },
];

export default function HomePage() {
  const router = useRouter();
  const { role } = useSession();
  const [acc, setAcc] = useState<Stat>(null);
  const [fab, setFab] = useState<Stat>(null);

  // useRequireRole bounces here with ?denied=<section> when a section admin opens
  // the other section's admin pages. Both stock pages stay publicly viewable, so
  // this only ever means "you can't MANAGE that side".
  const denied = typeof router.query.denied === "string" ? router.query.denied : null;

  useEffect(() => {
    // Each side loads independently: a missing/empty fabric table must not stop
    // the accessory card from rendering (and vice versa), so no Promise.all here.
    Promise.all([getAccessories(), getLotMap()])
      .then(([items, lm]) => setAcc({
        items: items.length,
        value: items.reduce((s, a) => s + accValue(lm.get(a.id) ?? []), 0),
      }))
      .catch(() => setAcc({ items: 0, value: 0 }));

    Promise.all([getFabrics(), getFabricLotMap()])
      .then(([items, lm]) => setFab({
        items: items.length,
        value: items.reduce((s, f) => s + fabValue(lm.get(f.id) ?? []), 0),
      }))
      .catch(() => setFab({ items: 0, value: 0 }));
  }, []);

  const stats: Record<string, Stat> = { "/stock": acc, "/fabrics": fab };

  return (
    <div style={{ maxWidth: 720, margin: "0 auto", paddingTop: "8vh" }}>
      <div style={{ textAlign: "center", marginBottom: 36 }}>
        <div style={{ fontFamily: "var(--mono)", fontSize: 15, color: "var(--accent)", letterSpacing: "0.12em" }}>
          ACCESSORY · FABRIC
        </div>
        <h1 style={{ fontSize: 26, fontWeight: 500, marginTop: 8 }}>เลือกระบบสต็อค</h1>
        <div style={{ fontSize: 16, color: "var(--text3)", marginTop: 4 }}>Choose a stock system</div>
        {role && (
          <div style={{ fontSize: 14, color: "var(--text3)", marginTop: 10 }}>
            เข้าสู่ระบบในฐานะ <strong style={{ color: "var(--text2)" }}>{ROLE_LABELS[role].th}</strong>
          </div>
        )}
      </div>

      {denied && (
        <div style={{ marginBottom: 18, padding: "10px 14px", background: "var(--red2)", border: "1px solid var(--red)",
          borderRadius: "var(--r)", fontSize: 14, color: "var(--text)" }}>
          บัญชีของคุณไม่มีสิทธิ์จัดการระบบ{denied === "fabric" ? "ผ้า" : "อุปกรณ์"} — ดูสต็อคได้ แต่แก้ไขไม่ได้
        </div>
      )}

      <div className="home-grid">
        {SECTIONS.map((s) => {
          const st = stats[s.href];
          const canAdmin = roleCanAccess(role, s.section);
          return (
            <Link key={s.href} href={s.href} className="card home-card"
              style={{ display: "block", padding: 24, transition: "border-color 0.15s, transform 0.15s" }}>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
                <div style={{ fontSize: 21, fontWeight: 500 }}>{s.title}</div>
                {role && (
                  <span style={{ fontSize: 12, color: canAdmin ? "var(--green)" : "var(--text3)", whiteSpace: "nowrap" }}>
                    {canAdmin ? "จัดการได้" : "ดูอย่างเดียว"}
                  </span>
                )}
              </div>
              <div style={{ fontSize: 15, color: "var(--text3)", letterSpacing: "0.04em", marginBottom: 10 }}>{s.en}</div>
              <div style={{ fontSize: 14, color: "var(--text2)", minHeight: 42 }}>{s.blurb}</div>
              <div style={{ borderTop: "1px solid var(--border)", marginTop: 14, paddingTop: 12, display: "flex", justifyContent: "space-between", fontSize: 14 }}>
                {st === null ? (
                  <span style={{ color: "var(--text3)" }}>กำลังโหลด…</span>
                ) : (
                  <>
                    <span style={{ color: "var(--text3)" }}>
                      <span style={{ fontFamily: "var(--mono)", color: "var(--text)" }}>{st.items.toLocaleString()}</span> รายการ
                    </span>
                    <span style={{ fontFamily: "var(--mono)", color: "var(--text2)" }}>
                      ฿{st.value.toLocaleString("th-TH", { maximumFractionDigits: 0 })}
                    </span>
                  </>
                )}
              </div>
            </Link>
          );
        })}
      </div>

      <div style={{ textAlign: "center", marginTop: 28, fontSize: 14, color: "var(--text3)" }}>
        ซัพพลายเออร์ใช้ฐานข้อมูลเดียวกันทั้งสองระบบ · Suppliers are shared between both systems
      </div>
    </div>
  );
}
