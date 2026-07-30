import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import { readRole } from "@/lib/auth";
import { getCostings, computeCosting, hasCosting, statusMeta, ORDER_STATUSES, type ProductCosting } from "@/lib/costing-store";

const fmt0 = (v: number) => (isFinite(v) ? v : 0).toLocaleString("th-TH", { maximumFractionDigits: 0 });

// The date an order is "counted" under for trends: prefer the production-release
// date, fall back to when it was logged.
const orderMonth = (c: ProductCosting): string => {
  const d = c.release_date || c.created_at || "";
  return d ? d.slice(0, 7) : "ไม่ระบุ";
};
const monthLabel = (key: string) => {
  if (key === "ไม่ระบุ") return key;
  const [y, m] = key.split("-");
  const th = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
  return `${th[Number(m) - 1] ?? m} ${String(Number(y) + 543).slice(2)}`;
};

// A horizontal-bar row (dependency-free).
function BarRow({ label, value, max, right, color }: { label: string; value: number; max: number; right: string; color?: string }) {
  const pct = max > 0 ? Math.max(2, (value / max) * 100) : 0;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(90px, 150px) 1fr auto", gap: 10, alignItems: "center", padding: "5px 0" }}>
      <div style={{ fontSize: 13, color: "var(--text2)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={label}>{label}</div>
      <div style={{ background: "var(--bg3)", borderRadius: 3, height: 16, overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: color ?? "var(--accent)", borderRadius: 3, transition: "width .2s" }} />
      </div>
      <div style={{ fontSize: 13, fontFamily: "var(--mono)", color: "var(--text2)", whiteSpace: "nowrap" }}>{right}</div>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card" style={{ padding: 18 }}>
      <h2 style={{ fontSize: 15, fontWeight: 500, color: "var(--text2)", marginBottom: 14 }}>{title}</h2>
      {children}
    </div>
  );
}

export default function CostingTrends() {
  const router = useRouter();
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [rows, setRows] = useState<ProductCosting[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const r = readRole();
    if (!r) { router.replace("/login"); return; }
    if (r !== "super") { router.replace("/"); return; }   // orders: super-admin only
    setAuthed(true);
  }, [router]);

  useEffect(() => {
    if (!authed) return;
    getCostings().then(setRows).catch(() => setRows([])).finally(() => setLoading(false));
  }, [authed]);

  const data = useMemo(() => {
    const rec = rows.map((c) => {
      const bd = computeCosting(c);
      const costed = hasCosting(c);
      const cancelled = (c.status || "quote") === "cancelled";
      const qty = Number(c.order_qty) || 0;
      const value = costed && !cancelled ? bd.sellingPrice * qty : 0;
      const cost = costed && !cancelled ? bd.totalCost * qty : 0;
      return { c, qty, value, cost, cancelled };
    });

    // ── by status ──
    const byStatus = ORDER_STATUSES.map((st) => {
      const items = rec.filter((r) => (r.c.status || "quote") === st.key);
      return {
        st,
        count: items.length,
        value: items.reduce((s, r) => s + (r.cancelled ? 0 : (hasCosting(r.c) ? computeCosting(r.c).sellingPrice * r.qty : 0)), 0),
      };
    });

    // ── by month ──
    const monthMap = new Map<string, { count: number; value: number }>();
    for (const r of rec) {
      const k = orderMonth(r.c);
      const cur = monthMap.get(k) ?? { count: 0, value: 0 };
      cur.count += 1;
      cur.value += r.value;
      monthMap.set(k, cur);
    }
    const months = Array.from(monthMap.entries())
      .filter(([k]) => k !== "ไม่ระบุ")
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-12);

    // ── by customer (value, top 8) ──
    const custMap = new Map<string, { count: number; value: number }>();
    for (const r of rec) {
      const k = r.c.customer.trim() || "ไม่ระบุลูกค้า";
      const cur = custMap.get(k) ?? { count: 0, value: 0 };
      cur.count += 1;
      cur.value += r.value;
      custMap.set(k, cur);
    }
    const customers = Array.from(custMap.entries()).sort((a, b) => b[1].value - a[1].value).slice(0, 8);

    // ── by product type (count, top 8) ──
    const typeMap = new Map<string, number>();
    for (const r of rec) {
      const k = r.c.product_type.trim() || "ไม่ระบุ";
      typeMap.set(k, (typeMap.get(k) ?? 0) + 1);
    }
    const types = Array.from(typeMap.entries()).sort((a, b) => b[1] - a[1]).slice(0, 8);

    const totalOrders = rec.length;
    const activePieces = rec.reduce((s, r) => s + (r.cancelled ? 0 : r.qty), 0);
    const totalValue = rec.reduce((s, r) => s + r.value, 0);
    const totalCost = rec.reduce((s, r) => s + r.cost, 0);
    const uncosted = rows.filter((c) => !hasCosting(c) && (c.status || "quote") !== "cancelled").length;

    return { byStatus, months, customers, types, totalOrders, activePieces, totalValue, totalCost, uncosted };
  }, [rows]);

  if (authed !== true) return null;

  const maxMonth = Math.max(1, ...data.months.map(([, v]) => v.value));
  const maxCust = Math.max(1, ...data.customers.map(([, v]) => v.value));
  const maxType = Math.max(1, ...data.types.map(([, v]) => v));
  const grossProfit = data.totalValue - data.totalCost;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <div>
          <Link href="/costing" style={{ fontSize: 14, color: "var(--text3)" }}>← กลับไปรายการ</Link>
          <h1 style={{ fontSize: 22, fontWeight: 500, marginTop: 4 }}>แนวโน้มออเดอร์</h1>
          <div style={{ fontSize: 14, color: "var(--text3)" }}>Order & costing trends</div>
        </div>
      </div>

      {loading ? (
        <div style={{ padding: 40, color: "var(--text3)" }}>กำลังโหลด…</div>
      ) : rows.length === 0 ? (
        <div className="card" style={{ padding: 40, textAlign: "center", color: "var(--text3)" }}>
          ยังไม่มีข้อมูลออเดอร์ — <Link href="/costing/new" style={{ color: "var(--accent)" }}>เพิ่มออเดอร์แรก</Link>
        </div>
      ) : (
        <>
          <div className="stat-grid" style={{ marginBottom: 16 }}>
            <div className="card" style={{ padding: "14px 16px" }}>
              <div style={{ fontSize: 13, color: "var(--text3)" }}>ออเดอร์ทั้งหมด</div>
              <div style={{ fontSize: 22, fontFamily: "var(--mono)", marginTop: 4 }}>{data.totalOrders.toLocaleString()}</div>
              <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 2 }}>ยังไม่คิดต้นทุน {data.uncosted}</div>
            </div>
            <div className="card" style={{ padding: "14px 16px" }}>
              <div style={{ fontSize: 13, color: "var(--text3)" }}>จำนวนตัว (ไม่รวมยกเลิก)</div>
              <div style={{ fontSize: 22, fontFamily: "var(--mono)", marginTop: 4 }}>{fmt0(data.activePieces)}</div>
            </div>
            <div className="card" style={{ padding: "14px 16px" }}>
              <div style={{ fontSize: 13, color: "var(--text3)" }}>มูลค่าขายรวม</div>
              <div style={{ fontSize: 22, fontFamily: "var(--mono)", marginTop: 4 }}>฿{fmt0(data.totalValue)}</div>
            </div>
            <div className="card" style={{ padding: "14px 16px" }}>
              <div style={{ fontSize: 13, color: "var(--text3)" }}>กำไรขั้นต้นรวม</div>
              <div style={{ fontSize: 22, fontFamily: "var(--mono)", marginTop: 4, color: "var(--green)" }}>฿{fmt0(grossProfit)}</div>
              <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 2 }}>ต้นทุน ฿{fmt0(data.totalCost)}</div>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 16, marginBottom: 16 }}>
            <Panel title="สถานะออเดอร์">
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {data.byStatus.map(({ st, count, value }) => (
                  <div key={st.key} style={{ flex: "1 1 150px", minWidth: 140, border: `1px solid ${st.color}44`, borderRadius: 6, padding: "10px 12px", background: `${st.color}0f` }}>
                    <div style={{ fontSize: 13, color: st.color, fontWeight: 500 }}>{st.th}</div>
                    <div style={{ fontSize: 20, fontFamily: "var(--mono)", marginTop: 2 }}>{count}</div>
                    <div style={{ fontSize: 12, color: "var(--text3)" }}>฿{fmt0(value)}</div>
                  </div>
                ))}
              </div>
            </Panel>
          </div>

          <div className="cost-trends-grid">
            <Panel title="มูลค่าขายรายเดือน">
              {data.months.length === 0 ? (
                <div style={{ color: "var(--text3)", fontSize: 13 }}>ยังไม่มีข้อมูลรายเดือน</div>
              ) : (
                data.months.map(([k, v]) => (
                  <BarRow key={k} label={monthLabel(k)} value={v.value} max={maxMonth} right={`฿${fmt0(v.value)} · ${v.count} ออเดอร์`} />
                ))
              )}
            </Panel>

            <Panel title="ลูกค้า (ตามมูลค่าขาย)">
              {data.customers.map(([k, v]) => (
                <BarRow key={k} label={k} value={v.value} max={maxCust} right={`฿${fmt0(v.value)}`} color="#7c3aed" />
              ))}
            </Panel>

            <Panel title="ชนิดสินค้า (ตามจำนวนออเดอร์)">
              {data.types.map(([k, v]) => (
                <BarRow key={k} label={k} value={v} max={maxType} right={`${v}`} color="#d97706" />
              ))}
            </Panel>
          </div>
        </>
      )}
    </div>
  );
}
