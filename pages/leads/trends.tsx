import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import { readRole, canLeads } from "@/lib/auth";
import { LoadError } from "@/lib/load-error";
import {
  getLeads, LEAD_STATUSES, LEAD_CHANNELS, LOST_REASONS,
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
//
// Two shapes only, chosen by what the data IS: months are TIME, so they run left→right as
// columns (a trend you can see in one look); everything else is categories compared against
// each other, so they stay horizontal bars where long Thai labels have room to breathe.
//
// แบบใหม่ / แบบเดิม toggle: the column chart and the drop-off funnel are a judgement call that
// only real, populated data can settle, so the previous all-horizontal-bars layout is kept as
// a switch (remembered per browser) rather than deleted. The two views read the SAME derived
// numbers — only the presentation differs. Drop the "classic" branches once one has won.

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
// The two numbers on the right are SEPARATE grid cells with fixed widths, so counts line up
// under counts and percentages under percentages; as one free-form string they came out
// ragged and could not be scanned down the column.
function BarRow({ label, value, max, note, color, title }: {
  label: string; value: number; max: number; note?: string; color?: string; title?: string;
}) {
  const w = max > 0 && value > 0 ? Math.max(2, (value / max) * 100) : 0;
  return (
    <div title={title}
      style={{ display: "grid", gridTemplateColumns: "minmax(84px, 148px) 1fr 40px 78px", gap: 10, alignItems: "center", padding: "5px 0" }}>
      <div style={{ fontSize: 13, color: "var(--text2)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={label}>{label}</div>
      <div style={{ background: "var(--bg3)", borderRadius: 3, height: 16, overflow: "hidden" }}>
        <div style={{ width: `${w}%`, height: "100%", background: color ?? "var(--accent)", borderRadius: 3, transition: "width .2s" }} />
      </div>
      <div style={{ fontSize: 13, fontFamily: "var(--mono)", color: "var(--text2)", textAlign: "right" }}>{fmt0(value)}</div>
      <div style={{ fontSize: 12, fontFamily: "var(--mono)", color: "var(--text3)", textAlign: "right", whiteSpace: "nowrap" }}>{note ?? ""}</div>
    </div>
  );
}

// Months as columns. Heights are in PIXELS off a fixed plot height rather than percentages:
// the count sits above each column as a sibling, so a percentage-height bar would push the
// tallest column out of the plot area.
const PLOT_H = 132;

function MonthColumns({ data, max }: { data: { key: string; count: number; won: number }[]; max: number }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 6, overflowX: "auto", paddingTop: 4 }}>
      {data.map((d) => {
        const h = max > 0 && d.count > 0 ? Math.max(3, Math.round((d.count / max) * PLOT_H)) : 0;
        const wonH = d.count > 0 ? Math.round((d.won / d.count) * 100) : 0;
        return (
          <div key={d.key} style={{ flex: "1 1 0", minWidth: 30, display: "flex", flexDirection: "column", alignItems: "center" }}
            title={`${monthLabel(d.key)} · ลีด ${d.count} · ได้งาน ${d.won}`}>
            <div style={{ height: PLOT_H, width: "100%", display: "flex", flexDirection: "column", justifyContent: "flex-end", alignItems: "center" }}>
              <span style={{ fontSize: 11, fontFamily: "var(--mono)", color: "var(--text3)", marginBottom: 3 }}>{d.count || ""}</span>
              <div style={{ width: "100%", maxWidth: 46, height: h, background: "var(--accent)", borderRadius: "3px 3px 0 0", display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
                {d.won > 0 && <div style={{ height: `${wonH}%`, background: "var(--green)", borderRadius: wonH >= 100 ? "3px 3px 0 0" : 0 }} />}
              </div>
            </div>
            <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 6, whiteSpace: "nowrap" }}>{monthLabel(d.key)}</div>
          </div>
        );
      })}
    </div>
  );
}

function Swatch({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, color: "var(--text3)" }}>
      <span style={{ width: 10, height: 10, borderRadius: 2, background: color }} />{children}
    </span>
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

// The pipeline as an ordered path. ไม่ได้งาน is not a step on it — a lead can drop out at any
// stage — so it is counted separately below the funnel instead of as its own bar.
const STAGES = LEAD_STATUSES.filter((st) => st.key !== "lost");

export default function LeadTrends() {
  const router = useRouter();
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [rows, setRows] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  // Starts on แบบใหม่; a saved choice is read after mount so the server-rendered markup matches.
  const [chart, setChart] = useState<"new" | "classic">("new");

  // Super or the dedicated `leads` sales account (canLeads). It is only half the story: `customer_leads` is
  // closed to the browser's anon key by row level security (see lib/supabase-admin.ts), so
  // the data is safe with or without this redirect. What the redirect adds is an honest
  // answer — without it a stranger opening this URL now gets a silent empty board, because
  // the API refuses them, which looks like a bug rather than a locked door.
  useEffect(() => {
    const r = readRole();
    if (!r) { router.replace("/login"); return; }
    if (!canLeads(r)) { router.replace("/"); return; }
    setAuthed(true);
  }, [router]);
  useEffect(() => {
    if (!authed) return;
    getLeads().then(setRows)
      .catch((e: any) => { setRows([]); setErr(e?.message ?? "โหลดข้อมูลไม่สำเร็จ"); })
      .finally(() => setLoading(false));
    const saved = localStorage.getItem("leadTrendsChart");
    if (saved === "classic" || saved === "new") setChart(saved);
  }, [authed]);

  const pickChart = (v: "new" | "classic") => {
    setChart(v);
    try { localStorage.setItem("leadTrendsChart", v); } catch { /* private mode — the choice just won't stick */ }
  };

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
      .slice(-MONTHS_SHOWN)
      .map(([key, v]) => ({ key, ...v }));

    // Funnel — where leads DROP OFF, which is the question a pipeline chart is for. Only the
    // current stage is stored, so "reached this stage" is inferred from the stage order: a lead
    // sitting at ส่งต่อเมอร์ must have been through กำลังคุย. Leads closed as ไม่ได้งาน left the
    // path at an unrecorded point, so they are excluded rather than guessed at.
    const stageIdx = new Map<string, number>(STAGES.map((st, i) => [st.key, i]));
    const live = rows.filter((l) => l.status !== "lost");
    const funnel = STAGES.map((st, i) => ({
      ...st,
      reached: live.filter((l) => (stageIdx.get(l.status || "new") ?? 0) >= i).length,
      here: rows.filter((l) => (l.status || "new") === st.key).length,
    }));

    // แบบเดิม's pipeline: simply how many sit in each stage right now, ไม่ได้งาน included.
    const byStatus = LEAD_STATUSES.map((st) => ({
      ...st, count: rows.filter((l) => (l.status || "new") === st.key).length,
    }));

    // Per-channel: how many came in, and how many of those closed as won.
    const channels = countBy(rows, (l) => l.channel, LEAD_CHANNELS)
      .map(([k, v]) => ({
        key: k, count: v,
        won: rows.filter((l) => bucket(l.channel) === k && l.status === "won").length,
      }))
      .sort((a, b) => b.count - a.count);

    const products = countBy(rows, (l) => l.product_type, []).sort((a, b) => b[1] - a[1]);
    const lostReasons = countBy(rows.filter((l) => l.status === "lost"), (l) => l.lost_reason, LOST_REASONS)
      .sort((a, b) => b[1] - a[1]);

    return { all, won, lost, open, due, closed, months, funnel, byStatus, channels, products, lostReasons };
  }, [rows]);

  if (authed !== true) return null;   // never flash the charts while redirecting

  const maxMonth = Math.max(1, ...s.months.map((m) => m.count));
  const maxFunnel = Math.max(1, ...s.funnel.map((f) => f.reached));
  const maxStatus = Math.max(1, ...s.byStatus.map((f) => f.count));
  const maxChannel = Math.max(1, ...s.channels.map((c) => c.count));
  const maxProduct = Math.max(1, ...s.products.map(([, v]) => v));
  const maxLost = Math.max(1, ...s.lostReasons.map(([, v]) => v));

  return (
    <div>
      <LoadError msg={err} />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 500 }}>แนวโน้มลีดลูกค้า</h1>
          <div style={{ fontSize: 14, color: "var(--text3)" }}>ภาพรวมลีดที่เข้ามา · ช่องทาง · อัตราปิดการขาย</div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ display: "flex", border: "1px solid var(--border)", borderRadius: "var(--r)", overflow: "hidden" }}>
            {([["new", "แบบใหม่"], ["classic", "แบบเดิม"]] as const).map(([v, th]) => (
              <button key={v} onClick={() => pickChart(v)}
                style={{
                  border: "none", borderRadius: 0, padding: "7px 14px",
                  background: chart === v ? "var(--text)" : "var(--bg2)", color: chart === v ? "#fff" : "var(--text3)",
                }}>
                {th}
              </button>
            ))}
          </div>
          <Link href="/leads"><button>← กลับไปกระดาน</button></Link>
        </div>
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

          {/* แบบใหม่: the month trend is the headline — full width, and the only time axis. */}
          {chart === "new" && (
            <div style={{ marginBottom: 14 }}>
              <Panel title="ลีดใหม่ต่อเดือน" hint={`${MONTHS_SHOWN} เดือนล่าสุดที่มีข้อมูล · นับตามวันที่รับเรื่อง`}>
                <MonthColumns data={s.months} max={maxMonth} />
                <div style={{ display: "flex", gap: 14, marginTop: 12, paddingTop: 10, borderTop: "1px solid var(--border)" }}>
                  <Swatch color="var(--accent)">ลีดที่เข้ามา</Swatch>
                  <Swatch color="var(--green)">ปิดได้งาน</Swatch>
                </div>
              </Panel>
            </div>
          )}

          <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))" }}>
            {/* แบบเดิม: months sit in the grid as one more horizontal-bar panel. */}
            {chart === "classic" && (
              <Panel title="ลีดใหม่ต่อเดือน" hint={`${MONTHS_SHOWN} เดือนล่าสุดที่มีข้อมูล · นับตามวันที่รับเรื่อง`}>
                {s.months.map((m) => (
                  <BarRow key={m.key} label={monthLabel(m.key)} value={m.count} max={maxMonth}
                    note={m.won > 0 ? `ได้ ${m.won}` : ""} />
                ))}
              </Panel>
            )}

            {chart === "new" ? (
              <Panel title="ไปป์ไลน์ · ผ่านแต่ละขั้น" hint="กี่รายไปถึงขั้นนั้น และเหลือกี่ % จากขั้นก่อนหน้า (ไม่รวมที่ปิดเป็นไม่ได้งาน)">
                {s.funnel.map((f, i) => (
                  <BarRow key={f.key} label={f.th} value={f.reached} max={maxFunnel} color={f.color}
                    note={i === 0 ? "" : `→ ${pct(f.reached, s.funnel[i - 1].reached)}`}
                    title={`${f.th} · ไปถึงขั้นนี้ ${f.reached} ราย · ค้างอยู่ขั้นนี้ตอนนี้ ${f.here} ราย`} />
                ))}
                <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--border)", fontSize: 12, color: "var(--text3)" }}>
                  ปิดเป็น “ไม่ได้งาน” {fmt0(s.lost)} ราย ({pct(s.lost, s.all)} ของทั้งหมด) — หล่นออกได้ทุกขั้น จึงไม่นับรวมในแท่งด้านบน
                </div>
              </Panel>
            ) : (
              <Panel title="สถานะในไปป์ไลน์" hint="เรียงตามลำดับขั้น ไม่ใช่ตามจำนวน">
                {s.byStatus.map((f) => (
                  <BarRow key={f.key} label={f.th} value={f.count} max={maxStatus} color={f.color}
                    note={pct(f.count, s.all)} />
                ))}
              </Panel>
            )}

            <Panel title="ตามช่องทาง" hint="ลีดที่เข้ามา และกี่รายที่ปิดได้">
              {s.channels.map((c) => (
                <BarRow key={c.key} label={c.key} value={c.count} max={maxChannel} color="#2563eb"
                  note={`ได้ ${c.won} · ${pct(c.won, c.count)}`} />
              ))}
            </Panel>

            <Panel title="ประเภทสินค้าที่สอบถาม">
              {s.products.length === 0 ? (
                <div style={{ fontSize: 13, color: "var(--text3)" }}>ยังไม่มีข้อมูลประเภทสินค้า</div>
              ) : s.products.map(([k, v]) => (
                <BarRow key={k} label={k} value={v} max={maxProduct} color="#d97706" note={pct(v, s.all)} />
              ))}
            </Panel>

            <Panel title="เหตุผลที่ไม่ได้งาน" hint="เฉพาะลีดที่ปิดเป็น “ไม่ได้งาน”">
              {s.lostReasons.length === 0 ? (
                <div style={{ fontSize: 13, color: "var(--text3)" }}>ยังไม่มีลีดที่ปิดเป็นไม่ได้งาน</div>
              ) : s.lostReasons.map(([k, v]) => (
                <BarRow key={k} label={k} value={v} max={maxLost} color="var(--red)" note={pct(v, s.lost)} />
              ))}
            </Panel>
          </div>
        </>
      )}
    </div>
  );
}
