import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import { readRole, type Role } from "@/lib/auth";
import { getCostings, deleteCosting, computeCosting, hasCosting, statusMeta, ORDER_STATUSES, type ProductCosting } from "@/lib/costing-store";
import { usePagination, PaginationBar } from "@/lib/pagination";
import { SearchInput } from "@/lib/search";

function StatusChip({ status }: { status: string }) {
  const m = statusMeta(status);
  return (
    <span style={{
      display: "inline-block", padding: "2px 9px", borderRadius: 999, fontSize: 12, whiteSpace: "nowrap",
      color: m.color, background: `${m.color}1a`, border: `1px solid ${m.color}55`,
    }}>{m.th}</span>
  );
}

const fmt0 = (v: number) => (isFinite(v) ? v : 0).toLocaleString("th-TH", { maximumFractionDigits: 0 });
const fmt2 = (v: number) => (isFinite(v) ? v : 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card" style={{ padding: "14px 16px" }}>
      <div style={{ fontSize: 13, color: "var(--text3)" }}>{label}</div>
      <div style={{ fontSize: 22, fontFamily: "var(--mono)", marginTop: 4 }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

export default function CostingList() {
  const router = useRouter();
  const [role, setRole] = useState<Role | null>(null);
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [rows, setRows] = useState<ProductCosting[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    const r = readRole();
    if (!r) { router.replace("/login"); return; }
    if (r !== "super") { router.replace("/"); return; }   // orders: super-admin only
    setRole(r);
    setAuthed(true);
  }, [router]);

  const load = () => {
    setLoading(true);
    getCostings()
      .then(setRows)
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  };
  useEffect(() => { if (authed) load(); }, [authed]);

  // Precompute the selling price + costed flag per row once.
  const priced = useMemo(
    () => rows.map((c) => ({ c, bd: computeCosting(c), costed: hasCosting(c) })),
    [rows]
  );

  // Count per status (over the search-filtered set, ignoring the status filter itself).
  const searched = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return priced;
    return priced.filter(({ c }) =>
      [c.style_no, c.po_no, c.pn_no, c.customer, c.product_type, c.description, c.brand]
        .some((v) => String(v ?? "").toLowerCase().includes(q))
    );
  }, [priced, query]);

  const statusCounts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const { c } of searched) m[c.status || "quote"] = (m[c.status || "quote"] ?? 0) + 1;
    return m;
  }, [searched]);

  const filtered = useMemo(
    () => (statusFilter ? searched.filter(({ c }) => (c.status || "quote") === statusFilter) : searched),
    [searched, statusFilter]
  );

  const totals = useMemo(() => {
    let pieces = 0, cost = 0, value = 0;
    // Cancelled orders don't count toward pipeline value.
    for (const { c, bd, costed } of priced) {
      if ((c.status || "quote") === "cancelled") continue;
      pieces += Number(c.order_qty) || 0;
      if (costed) {
        cost += bd.totalCost * (Number(c.order_qty) || 0);
        value += bd.sellingPrice * (Number(c.order_qty) || 0);
      }
    }
    return { pieces, cost, value };
  }, [priced]);

  const { page, setPage, totalPages, pageItems, rangeStart, rangeEnd, total } = usePagination(filtered, query + "|" + statusFilter);

  const remove = async (c: ProductCosting) => {
    if (role !== "super") return;
    const label = c.style_no || c.po_no || c.customer || "รายการนี้";
    if (!confirm(`ลบต้นทุน "${label}" ?`)) return;
    setBusy(c.id);
    try {
      await deleteCosting(c.id);
      setRows((rs) => rs.filter((r) => r.id !== c.id));
    } catch (e: any) {
      alert(e.message ?? "ลบไม่สำเร็จ");
    } finally {
      setBusy(null);
    }
  };

  if (authed !== true) return null;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 500 }}>ออเดอร์</h1>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {/* Trends button hidden for now (page kept at /costing/trends):
          <Link href="/costing/trends"><button>📈 แนวโน้ม</button></Link> */}
          {/* Excel import hidden for now — no real import template yet, and this is live
              so we don't want anyone importing example data. Page kept at /costing/import,
              but it redirects back until re-enabled here.
          <Link href="/costing/import"><button>นำเข้า Excel</button></Link> */}
          <Link href="/costing/new"><button className="primary">+ เพิ่มออเดอร์</button></Link>
        </div>
      </div>

      <div className="stat-grid" style={{ marginBottom: 16 }}>
        <StatCard label="ออเดอร์ทั้งหมด" value={rows.length.toLocaleString()} />
        <StatCard label="จำนวนตัวรวม" value={fmt0(totals.pieces)} sub="ไม่รวมที่ยกเลิก" />
        <StatCard label="ต้นทุนรวม" value={`฿${fmt0(totals.cost)}`} sub="เฉพาะที่คิดต้นทุนแล้ว" />
        <StatCard label="มูลค่าขายรวม" value={`฿${fmt0(totals.value)}`} sub="เฉพาะที่คิดต้นทุนแล้ว" />
      </div>

      <div className="card">
        <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: 10 }}>
          <SearchInput value={query} onChange={setQuery} placeholder="ค้นหา Style / PO / ลูกค้า / ชนิดสินค้า…" leftIcon="🔍" style={{ maxWidth: 420 }} />
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button onClick={() => setStatusFilter("")}
              style={{ padding: "4px 12px", fontSize: 13, borderColor: statusFilter === "" ? "var(--accent)" : undefined, color: statusFilter === "" ? "var(--accent)" : undefined }}>
              ทั้งหมด ({searched.length})
            </button>
            {ORDER_STATUSES.map((st) => (
              <button key={st.key} onClick={() => setStatusFilter(statusFilter === st.key ? "" : st.key)}
                style={{ padding: "4px 12px", fontSize: 13,
                  borderColor: statusFilter === st.key ? st.color : undefined,
                  color: statusFilter === st.key ? st.color : "var(--text2)" }}>
                {st.th} ({statusCounts[st.key] ?? 0})
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div style={{ padding: 40, color: "var(--text3)", textAlign: "center" }}>กำลังโหลด…</div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: 40, color: "var(--text3)", textAlign: "center" }}>
            {rows.length === 0 ? "ยังไม่มีออเดอร์ — กด “เพิ่มออเดอร์” เพื่อเริ่ม" : "ไม่พบรายการที่ตรงกับคำค้นหา"}
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table>
              <thead className="sticky-head">
                <tr>
                  <th>สถานะ</th>
                  <th>Style / PO</th>
                  <th>ลูกค้า</th>
                  <th>ชนิดสินค้า</th>
                  <th>กำหนดส่ง</th>
                  <th className="num">จำนวนสั่ง</th>
                  <th className="num">ต้นทุน/ตัว</th>
                  <th className="num">ราคาขาย/ตัว</th>
                  <th className="num">มูลค่าออเดอร์</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {pageItems.map(({ c, bd, costed }) => (
                  <tr key={c.id} style={{ cursor: "pointer" }} onClick={() => router.push(`/costing/${c.id}`)}>
                    <td><StatusChip status={c.status} /></td>
                    <td>
                      <div style={{ color: "var(--text)" }}>{c.style_no || c.po_no || "—"}</div>
                      {c.style_no && c.po_no && <div style={{ fontSize: 12, color: "var(--text3)" }}>PO {c.po_no}</div>}
                    </td>
                    <td>{c.customer || "—"}</td>
                    <td>{c.product_type || "—"}</td>
                    <td style={{ color: c.due_date ? "var(--text2)" : "var(--text3)" }}>{c.due_date || "—"}</td>
                    <td className="num">{fmt0(Number(c.order_qty))}</td>
                    <td className="num">{costed ? fmt2(bd.totalCost) : "—"}</td>
                    <td className="num" style={{ color: "var(--accent)", fontWeight: 500 }}>{costed ? fmt2(bd.sellingPrice) : "—"}</td>
                    <td className="num">{costed ? `฿${fmt0(bd.sellingPrice * (Number(c.order_qty) || 0))}` : "—"}</td>
                    <td className="num" onClick={(e) => e.stopPropagation()}>
                      <div style={{ display: "flex", gap: 4, justifyContent: "flex-end" }}>
                        <Link href={`/costing/${c.id}`}><button className="ghost" style={{ padding: "3px 8px", fontSize: 13 }}>แก้ไข</button></Link>
                        {role === "super" && (
                          <button className="ghost" style={{ padding: "3px 8px", fontSize: 13, color: "var(--red)" }}
                            disabled={busy === c.id} onClick={() => remove(c)}>ลบ</button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <PaginationBar page={page} setPage={setPage} totalPages={totalPages} rangeStart={rangeStart} rangeEnd={rangeEnd} total={total} />
      </div>
    </div>
  );
}
