import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  getLeads, LEAD_STATUSES, LEAD_CHANNELS, LEAD_OWNERS, LOST_REASONS,
  isClosed, isDue, type Lead,
} from "@/lib/lead-store";

// แนวโน้มลีดลูกค้า — the leads section's own trends page.
//
// Deliberately self-contained: leads share no data, no auth and no components with the
// stock/order sections, so this page duplicates the small BarRow/Panel presentation rather
// than importing from /costing/trends. Same reasoning as the two parallel stock systems —
// independent sections are allowed to repeat 20 lines of layout to stay uncoupled.
//
// Ungated like the rest of /leads (see the note at the top of pages/leads/index.tsx).
//
// Everything here is DERIVED from the rows at render time — no stored aggregates, matching
// the app's derive-don't-store rule. Money is deliberately NOT charted: target_price and qty
// are free text on purpose ("300-500", "แล้วแต่แบบ"), so summing them would invent precision.

const fmt0 = (v: number) => (isFinite(v) ? v : 0).toLocaleString("th-TH", { maximumFractionDigits: 0 });
const pct = (n: number, d: number) => (d > 0 ? `${((n / d) * 100).toFixed(0)}%` : "—");

// The month a lead is counted under: when it came in, falling back to when the row was made.
const leadMonth = (l: Lead): string => {
  const d = l.received_date || l.created_at || "";
  return d ? d.slice(0, 7) : "ไม่ระบุ";
};
const monthLabel = (key: string) => {
  if (key === "ไม่ระบุ") return key;
  const [y, m] = key.split("-");
  const th = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
  return `${th[Number(m) - 1] ?? m} ${String(Number(y) + 543).slice(2)}`;
};

// A horizontal-bar row (dependency-free — no charting library anywhere in this project).
function BarRow({ label, value, max, right, color }: {
  label: string; value: number; max: number; right: string; color?: string;
}) {
  const w = max > 0 && value > 0 ? Math.max(2, (value / max) * 100) : 0;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(90px, 150px) 1fr auto", gap: 10, alignItems: "center", padding: "5px 0" }}>
      <div style={{ fontSize: 13, color: "var(--text2)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={label}>{label}</div>
      <div style={{ background: "var(--bg3)", borderRadius: 3, height: 16, overflow: "hidden" }}>
        <div style={{ width: `${w}%`, height: "100%", background: color ?? "var(--accent)", borderRadius: 3, transition: "width .2s" }} />
      </div>
      <div style={{ fontSize: 13, fontFamily: "var(--mono)", color: "var(--text2)", whiteSpace: "nowrap" }}>{right}</div>
    </div>
  );
}

function Panel({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="card" style={{ padding: 18 }}>
      <h2 style={{ fontSize: 15, fontWeight: 500, color: "var(--text2)", marginBottom: hint ? 4 : 14 }}>{title}</h2>
      {hint && <div style={{ fontSize: 12, color: "var(--text3)", marginBottom: 12 }}>{hint}</div>}
      {children}
    </div>
  );
}

function StatCard({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="card" style={{ padding: "12px 15px" }}>
      <div style={{ fontSize: 12, color: "var(--text3)" }}>{label}</div>
      <div style={{ fontSize: 22, fontFamily: "var(--mono)", marginTop: 3, color: tone ?? "var(--text)" }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

// Count rows into a label→count map, keeping a fixed preset order first and appending any
// off-list values the sheet contains (the dropdowns are constants, but imported rows are free text).
const bucket = (v: string) => (v || "").trim() || "ไม่ระบุ";

function countBy(rows: Lead[], pick: (l: Lead) => string, presets: string[]): [string, number][] {
  const m = new Map<string, number>();
  for (const p of presets) m.set(p, 0);
  for (const l of rows) {
    const k = bucket(pick(l));
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return Array.from(m.entries()).filter(([, v]) => v > 0);
}

const MONTHS_SHOWN = 12;

export default function LeadTrends() {
  const [rows, setRows] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getLeads().then(setRows).catch(() => setRows([])).finally(() => setLoading(false));
  }, []);

  const s = useMemo(() => {
    const all = rows.length;
    const won = rows.filter((l) => l.status === "won").length;
    const lost = rows.filter((l) => l.status === "lost").length;
    const open = rows.filter((l) => !isClosed(l.status)).length;
    const due = rows.filter(isDue).length;
    const closed = won + lost;

    // ลีดใหม่ต่อเดือน — last 12 months that actually have data, oldest first.
    const byMonth = new Map<string, { count: number; won: number }>();
    for (const l of rows) {
      const k = leadMonth(l);
      const cur = byMonth.get(k) ?? { count: 0, won: 0 };
      cur.count++;
      if (l.status === "won") cur.won++;
      byMonth.set(k, cur);
    }
    const months = Array.from(byMonth.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-MONTHS_SHOWN);

    // Funnel — fixed stage order so it reads as a pipeline, not a ranking.
    const funnel = LEAD_STATUSES.map((st) => ({
      ...st, count: rows.filter((l) => (l.status || "new") === st.key).length,
    }));

    // Per-channel: how many came in, and how many of those closed as won.
    const channels = countBy(rows, (l) => l.channel, LEAD_CHANNELS)
      .map(([k, v]) => ({
        key: k, count: v,
        won: rows.filter((l) => bucket(l.channel) === k && l.status === "won").length,
      }))
      .sort((a, b) => b.count - a.count);

    const owners = countBy(rows, (l) => l.owner, LEAD_OWNERS)
      .map(([k, v]) => ({
        key: k, count: v,
        won: rows.filter((l) => bucket(l.owner) === k && l.status === "won").length,
      }))
      .sort((a, b) => b.count - a.count);

    const products = countBy(rows, (l) => l.product_type, []).sort((a, b) => b[1] - a[1]);
    const lostReasons = countBy(rows.filter((l) => l.status === "lost"), (l) => l.lost_reason, LOST_REASONS)
      .sort((a, b) => b[1] - a[1]);

    return { all, won, lost, open, due, closed, months, funnel, channels, owners, products, lostReasons };
  }, [rows]);

  const maxMonth = Math.max(1, ...s.months.map(([, v]) => v.count));
  const maxFunnel = Math.max(1, ...s.funnel.map((f) => f.count));
  const maxChannel = Math.max(1, ...s.channels.map((c) => c.count));
  const maxOwner = Math.max(1, ...s.owners.map((o) => o.count));
  const maxProduct = Math.max(1, ...s.products.map(([, v]) => v));
  const maxLost = Math.max(1, ...s.lostReasons.map(([, v]) => v));

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 500 }}>แนวโน้มลีดลูกค้า</h1>
          <div style={{ fontSize: 14, color: "var(--text3)" }}>ภาพรวมลีดที่เข้ามา · ช่องทาง · อัตราปิดการขาย</div>
        </div>
        <Link href="/leads"><button>← กลับไปกระดาน</button></Link>
      </div>

      {loading ? (
        <div className="card" style={{ padding: 40, textAlign: "center", color: "var(--text3)" }}>กำลังโหลด…</div>
      ) : s.all === 0 ? (
        <div className="card" style={{ padding: 40, textAlign: "center", color: "var(--text3)" }}>
          <b style={{ display: "block", fontSize: 16, color: "var(--text)", marginBottom: 5 }}>ยังไม่มีข้อมูลลีด</b>
          เพิ่มลีดจากกระดาน หรือกด “นำเข้า Excel” ก่อน แล้วกราฟจะขึ้นเอง
        </div>
      ) : (
        <>
          <div className="stat-grid" style={{ display: "grid", gap: 10, marginBottom: 16 }}>
            <StatCard label="ลีดทั้งหมด" value={fmt0(s.all)} />
            <StatCard label="ยังเปิดอยู่" value={fmt0(s.open)} sub={`${pct(s.open, s.all)} ของทั้งหมด`} />
            <StatCard label="ได้งาน" value={fmt0(s.won)} tone="var(--green)" />
            <StatCard label="ไม่ได้งาน" value={fmt0(s.lost)} tone="var(--red)" />
            <StatCard label="อัตราปิดการขาย" value={pct(s.won, s.closed)}
              sub={s.closed > 0 ? `ได้ ${s.won} จากที่ปิดแล้ว ${s.closed}` : "ยังไม่มีรายการที่ปิด"} />
            <StatCard label="ต้องติดตาม" value={fmt0(s.due)} tone={s.due > 0 ? "var(--red)" : undefined}
              sub="เลยวันนัดติดตาม" />
          </div>

          <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))" }}>
            <Panel title="ลีดใหม่ต่อเดือน" hint={`${MONTHS_SHOWN} เดือนล่าสุดที่มีข้อมูล · นับตามวันที่รับเรื่อง`}>
              {s.months.map(([k, v]) => (
                <BarRow key={k} label={monthLabel(k)} value={v.count} max={maxMonth}
                  right={v.won > 0 ? `${fmt0(v.count)} · ได้งาน ${v.won}` : fmt0(v.count)} />
              ))}
            </Panel>

            <Panel title="สถานะในไปป์ไลน์" hint="เรียงตามลำดับขั้น ไม่ใช่ตามจำนวน">
              {s.funnel.map((f) => (
                <BarRow key={f.key} label={f.th} value={f.count} max={maxFunnel}
                  right={`${fmt0(f.count)} · ${pct(f.count, s.all)}`} color={f.color} />
              ))}
            </Panel>

            <Panel title="ตามช่องทาง" hint="ลีดที่เข้ามา และกี่รายที่ปิดได้">
              {s.channels.map((c) => (
                <BarRow key={c.key} label={c.key} value={c.count} max={maxChannel}
                  right={`${fmt0(c.count)} · ได้ ${c.won} (${pct(c.won, c.count)})`} color="#2563eb" />
              ))}
            </Panel>

            <Panel title="ตามผู้รับผิดชอบ">
              {s.owners.length === 0 ? (
                <div style={{ fontSize: 13, color: "var(--text3)" }}>ยังไม่ได้ระบุผู้รับผิดชอบ</div>
              ) : s.owners.map((o) => (
                <BarRow key={o.key} label={o.key} value={o.count} max={maxOwner}
                  right={`${fmt0(o.count)} · ได้ ${o.won} (${pct(o.won, o.count)})`} color="#7c3aed" />
              ))}
            </Panel>

            <Panel title="ประเภทสินค้าที่สอบถาม">
              {s.products.length === 0 ? (
                <div style={{ fontSize: 13, color: "var(--text3)" }}>ยังไม่มีข้อมูลประเภทสินค้า</div>
              ) : s.products.map(([k, v]) => (
                <BarRow key={k} label={k} value={v} max={maxProduct} right={fmt0(v)} color="#d97706" />
              ))}
            </Panel>

            <Panel title="เหตุผลที่ไม่ได้งาน" hint="เฉพาะลีดที่ปิดเป็น “ไม่ได้งาน”">
              {s.lostReasons.length === 0 ? (
                <div style={{ fontSize: 13, color: "var(--text3)" }}>ยังไม่มีลีดที่ปิดเป็นไม่ได้งาน</div>
              ) : s.lostReasons.map(([k, v]) => (
                <BarRow key={k} label={k} value={v} max={maxLost} right={fmt0(v)} color="var(--red)" />
              ))}
            </Panel>
          </div>
        </>
      )}
    </div>
  );
}
